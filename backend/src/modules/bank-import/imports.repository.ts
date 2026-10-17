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

export interface ImportView {
  id: string;
  createdAt: string;
  source: string;
  status: ImportStatus;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  cardLast4: string | null;
  expenseId: string | null;
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

  /** An attempt that created nothing: kept with the reason. */
  async recordFailure(record: ImportRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO bank_imports
         (group_id, key_id, source, status, error_code, fingerprint, merchant, amount, currency,
          card_last4, occurred_at, title, body)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.groupId,
        record.keyId,
        record.source,
        record.status,
        record.errorCode ?? null,
        record.merchant ?? null,
        record.amount ?? null,
        record.currency ?? null,
        record.cardLast4 ?? null,
        record.occurredAt ?? null,
        record.title,
        record.body,
      ],
    );
  }

  /** The active cards of the group with these last four digits. */
  async cardsByLast4(groupId: string, last4: string, db: SqlExecutor): Promise<string[]> {
    const rows = await db.query<{ name: string }>(
      'SELECT name FROM cards WHERE group_id = $1 AND last4 = $2 AND archived_at IS NULL',
      [groupId, last4],
    );
    return rows.map((row) => row.name);
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

  async recent(groupId: string, limit: number): Promise<ImportView[]> {
    const rows = await this.database.query<{
      id: string;
      created_at: Date;
      source: string;
      status: ImportStatus;
      merchant: string | null;
      amount: number | null;
      currency: string | null;
      card_last4: string | null;
      expense_id: string | null;
    }>(
      `SELECT id, created_at, source, status, merchant, amount::float8 AS amount, currency, card_last4, expense_id
         FROM bank_imports WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [groupId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      source: row.source,
      status: row.status,
      merchant: row.merchant,
      amount: row.amount,
      currency: row.currency,
      cardLast4: row.card_last4,
      expenseId: row.expense_id,
    }));
  }
}
