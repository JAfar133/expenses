import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { scopeCondition, type ExpenseScope } from './scope.ts';

/** Reference data of a group: cards and categories. */
export class GroupsRepository {
  constructor(private readonly database: Database) {}

  /** Cards the user may add expenses to (not archived), in the group's order. Pass `db` inside a transaction. */
  async editableCardNames(scope: ExpenseScope, db: SqlExecutor = this.database): Promise<string[]> {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const rows = await db.query<{ name: string }>(
      `SELECT c.name FROM cards c
        WHERE c.archived_at IS NULL
          AND ${scopeCondition(scope, param, { level: 'edit', columns: { group: 'c.group_id', card: 'c.id' } })}
        ORDER BY c.position, c.name`,
      params,
    );
    return rows.map((row) => row.name);
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
  async categoryNames(groupId: string | null): Promise<string[]> {
    if (!groupId) return [];
    const rows = await this.database.query<{ name: string }>(
      'SELECT name FROM categories WHERE group_id = $1 AND archived_at IS NULL ORDER BY position, name',
      [groupId],
    );
    return rows.map((row) => row.name);
  }

  /** Archived categories: records may still use them, but the form does not offer them. */
  async archivedCategoryNames(groupId: string | null): Promise<string[]> {
    if (!groupId) return [];
    const rows = await this.database.query<{ name: string }>(
      'SELECT name FROM categories WHERE group_id = $1 AND archived_at IS NOT NULL',
      [groupId],
    );
    return rows.map((row) => row.name);
  }
}
