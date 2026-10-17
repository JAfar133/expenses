import type { PastExpense } from './merchant-category.ts';
import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';

export type ImportStatus =
  'created' | 'parse_error' | 'unsupported' | 'card_not_found' | 'card_ambiguous' | 'error';

export interface ImportRecord {
  groupId: string;
  keyId: string;
  source: string;
  status: ImportStatus;
  errorCode?: string | null;
  fingerprint?: string | null;
  merchant?: string | null;
  amount?: number | null;
  currency?: string | null;
  cardLast4?: string | null;
  occurredAt?: Date | null;
  /** The text of the notification, kept for diagnostics only */
  title: string;
  body: string;
}

/** An operation imported earlier from another source that may be the same purchase. */
/** An earlier import: the shop as written by the source, and what its expense is called and filed under now. */
export interface ImportedShop {
  merchant: string;
  name: string;
  category: string;
}

export interface CrossSourceMatch {
  importId: string;
  expenseId: string;
  source: string;
  merchant: string | null;
  cardLast4: string | null;
  occurredAt: Date;
  /** What the expense is called now and on which card (it may have been changed by a person) */
  expenseName: string;
  expenseCard: string;
}

/** SQL for the log of imported notifications. */
export class BankImportsRepository {
  constructor(private readonly database: Database) {}

  /**
   * Claims a real operation: false when an expense was already created from the same one (a repeat of the
   * notification). The row is filled with the expense id afterwards by `attachExpense`.
   */
  async claim(record: ImportRecord, db: SqlExecutor): Promise<string | undefined> {
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO bank_imports
         (group_id, key_id, source, status, fingerprint, merchant, amount, currency, card_last4,
          occurred_at, title, body)
       VALUES ($1, $2, $3, 'created', $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (group_id, fingerprint) WHERE status = 'created' DO NOTHING
       RETURNING id`,
      [
        record.groupId,
        record.keyId,
        record.source,
        record.fingerprint,
        record.merchant,
        record.amount,
        record.currency,
        record.cardLast4,
        record.occurredAt,
        record.title,
        record.body,
      ],
    );
    return row?.id;
  }

  /**
   * Created imports of ANOTHER source around the same moment with the same amount and currency: the same purchase may
   * have come from two places (the bank's notice and Apple Wallet). Deleted expenses do not count.
   */
  async otherSourceMatches(
    groupId: string,
    source: string,
    amount: number,
    currency: string,
    around: Date,
    windowMs: number,
    db: SqlExecutor,
  ): Promise<CrossSourceMatch[]> {
    const rows = await db.query<{
      import_id: string;
      expense_id: string;
      source: string;
      merchant: string | null;
      card_last4: string | null;
      occurred_at: Date;
      expense_name: string;
      expense_card: string;
    }>(
      `SELECT b.id AS import_id, b.expense_id, b.source, b.merchant, b.card_last4, b.occurred_at,
              e.name AS expense_name, e.card AS expense_card
         FROM bank_imports b JOIN expenses e ON e.id = b.expense_id
        WHERE b.group_id = $1 AND b.status = 'created' AND b.source <> $2
          AND b.amount = $3 AND b.currency = $4 AND e.deleted_at IS NULL
          AND b.occurred_at BETWEEN $5 AND $6
        ORDER BY abs(extract(epoch FROM (b.occurred_at - $7::timestamptz)))`,
      [
        groupId,
        source,
        amount,
        currency,
        new Date(around.getTime() - windowMs),
        new Date(around.getTime() + windowMs),
        around,
      ],
    );
    return rows.map((row) => ({
      importId: row.import_id,
      expenseId: row.expense_id,
      source: row.source,
      merchant: row.merchant,
      cardLast4: row.card_last4,
      occurredAt: row.occurred_at,
      expenseName: row.expense_name,
      expenseCard: row.expense_card,
    }));
  }

  async attachExpense(importId: string, expenseId: string, db: SqlExecutor): Promise<void> {
    await db.query('UPDATE bank_imports SET expense_id = $2 WHERE id = $1', [importId, expenseId]);
  }

  /** The expense an earlier import of the same operation created. */
  async existingExpense(
    groupId: string,
    fingerprint: string,
    db: SqlExecutor,
  ): Promise<string | null> {
    const [row] = await db.query<{ expense_id: string | null }>(
      `SELECT expense_id FROM bank_imports
        WHERE group_id = $1 AND fingerprint = $2 AND status = 'created'`,
      [groupId, fingerprint],
    );
    return row?.expense_id ?? null;
  }

  /** The active cards of the group with these last four digits. */
  async cardsByLast4(groupId: string, last4: string, db: SqlExecutor): Promise<string[]> {
    const rows = await db.query<{ name: string }>(
      'SELECT name FROM cards WHERE group_id = $1 AND last4 = $2 AND archived_at IS NULL',
      [groupId, last4],
    );
    return rows.map((row) => row.name);
  }

  /**
   * What earlier imports became NOW: the shop as the source wrote it, and the name and category the expense has today
   * (a person may have changed them). The newest first. This is how the app learns from corrections.
   */
  async importedHistory(groupId: string, db: SqlExecutor, limit = 500): Promise<ImportedShop[]> {
    return db.query<ImportedShop>(
      `SELECT b.merchant, e.name, e.category
         FROM bank_imports b JOIN expenses e ON e.id = b.expense_id
        WHERE b.group_id = $1 AND b.status = 'created' AND b.merchant IS NOT NULL
          AND e.deleted_at IS NULL
        ORDER BY b.created_at DESC LIMIT $2`,
      [groupId, limit],
    );
  }

  /** The names of the group's expenses with their categories, the newest first (one entry per name and category). */
  async pastExpenses(groupId: string, db: SqlExecutor, limit = 2000): Promise<PastExpense[]> {
    return db.query<PastExpense>(
      `SELECT name, category FROM expenses
        WHERE group_id = $1 AND deleted_at IS NULL
        GROUP BY name, category ORDER BY max(created_at) DESC LIMIT $2`,
      [groupId, limit],
    );
  }
}
