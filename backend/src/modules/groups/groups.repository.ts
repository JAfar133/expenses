import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { scopeCondition, type ExpenseScope } from './scope.ts';

/** Reference data of a group: cards and categories. */
export class GroupsRepository {
  constructor(private readonly database: Database) {}

  /** Cards the user may add expenses to (not archived) with their currencies, in the group's order. Pass `db` inside a transaction. */
  async editableCards(
    scope: ExpenseScope,
    db: SqlExecutor = this.database,
  ): Promise<{ name: string; currency: string }[]> {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    return db.query<{ name: string; currency: string }>(
      `SELECT c.name, c.currency FROM cards c
        WHERE c.archived_at IS NULL
          AND ${scopeCondition(scope, param, { level: 'edit', columns: { group: 'c.group_id', card: 'c.id' } })}
        ORDER BY c.position, c.name`,
      params,
    );
  }

  /** Names of the cards the user may add expenses to. */
  async editableCardNames(scope: ExpenseScope, db: SqlExecutor = this.database): Promise<string[]> {
    return (await this.editableCards(scope, db)).map((card) => card.name);
  }

  /** Cards of the group (not archived): a record may be moved to any of them. */
  async cardNames(groupId: string, db: SqlExecutor = this.database): Promise<string[]> {
    const rows = await db.query<{ name: string }>(
      'SELECT name FROM cards WHERE group_id = $1 AND archived_at IS NULL ORDER BY position, name',
      [groupId],
    );
    return rows.map((row) => row.name);
  }

  /** Categories of the group (not archived), in the owner's order. */
  async categoryNames(groupId: string | null, db: SqlExecutor = this.database): Promise<string[]> {
    if (!groupId) return [];
    const rows = await db.query<{ name: string }>(
      'SELECT name FROM categories WHERE group_id = $1 AND archived_at IS NULL ORDER BY position, name',
      [groupId],
    );
    return rows.map((row) => row.name);
  }

  /** Currencies of a card of the group and of the group's reporting; undefined for an unknown card. */
  async moneyContext(
    groupId: string | null,
    cardName: string,
    db: SqlExecutor = this.database,
  ): Promise<{ cardCurrency: string; reportingCurrency: string } | undefined> {
    if (!groupId) return undefined;
    const [row] = await db.query<{ card_currency: string; reporting_currency: string }>(
      `SELECT c.currency AS card_currency, g.reporting_currency
         FROM cards c JOIN groups g ON g.id = c.group_id
        WHERE c.group_id = $1 AND c.name = $2`,
      [groupId, cardName],
    );
    return row && { cardCurrency: row.card_currency, reportingCurrency: row.reporting_currency };
  }

  /** The reporting currency of a group; undefined for an unknown group. */
  async reportingCurrency(groupId: string | null): Promise<string | undefined> {
    if (!groupId) return undefined;
    const [row] = await this.database.query<{ reporting_currency: string }>(
      'SELECT reporting_currency FROM groups WHERE id = $1',
      [groupId],
    );
    return row?.reporting_currency;
  }

  /** All cards the user can see (any access level, archived ones too: their history stays), for filters. */
  async visibleCards(
    scope: ExpenseScope,
  ): Promise<{ name: string; currency: string; archived: boolean }[]> {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    return this.database.query<{ name: string; currency: string; archived: boolean }>(
      `SELECT c.name, c.currency, (c.archived_at IS NOT NULL) AS archived FROM cards c
        WHERE ${scopeCondition(scope, param, { columns: { group: 'c.group_id', card: 'c.id' } })}
        ORDER BY (c.archived_at IS NOT NULL), c.position, c.name`,
      params,
    );
  }

  /** For how many minutes a member may correct their own expense; 0: only the owner edits. */
  async memberEditMinutes(
    groupId: string | null,
    db: SqlExecutor = this.database,
  ): Promise<number> {
    if (!groupId) return 0;
    const [row] = await db.query<{ member_edit_minutes: number }>(
      'SELECT member_edit_minutes FROM groups WHERE id = $1',
      [groupId],
    );
    return row?.member_edit_minutes ?? 0;
  }

  /** Whether the user may add expenses to the card of the expense (access level `edit`). */
  async canAddToCardOf(
    userId: string,
    expenseId: string,
    db: SqlExecutor = this.database,
  ): Promise<boolean> {
    const rows = await db.query(
      `SELECT 1 FROM expenses e JOIN card_access a ON a.card_id = e.card_id
        WHERE e.id = $1 AND a.user_id = $2 AND a.level = 'edit'`,
      [expenseId, userId],
    );
    return rows.length > 0;
  }
}
