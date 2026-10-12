import { randomUUID } from 'node:crypto';
import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { dateText, timestampText } from '../../infrastructure/database/sql.ts';
import { scopeCondition, type ExpenseScope } from '../../modules/groups/scope.ts';
import type {
  Expense,
  ExpenseRepository,
  ExcelStatus,
  DeletedReason,
  ExcelChanges,
  ExpenseMoney,
  ExpenseOriginal,
  NameSuggestion,
  StoredExpense,
} from '../expense.repository.ts';

interface ExpenseRow {
  id: string;
  group_id: string | null;
  date: string;
  card: string;
  category: string;
  name: string;
  amount: number;
  source: 'app' | 'excel';
  excel_status: ExcelStatus;
  deleted_at: string | null;
  deleted_reason: DeletedReason | null;
  excel_snapshot: Expense | null;
  original_amount: number | null;
  original_currency: string | null;
  exchange_rate: number | null;
  card_currency: string | null;
  card_amount: number | null;
  reporting_currency: string | null;
  reporting_amount: number | null;
}

const COLUMNS = `id, group_id, ${dateText('date')} AS date, COALESCE((SELECT c.name FROM cards c WHERE c.id = card_id), card) AS card, category, name, amount, source, excel_status, ${timestampText('deleted_at')} AS deleted_at, deleted_reason, excel_snapshot, original_amount::float8 AS original_amount, original_currency, exchange_rate::float8 AS exchange_rate, card_currency, card_amount::float8 AS card_amount, reporting_currency, reporting_amount::float8 AS reporting_amount`;

/**
 * The Excel sync belongs to one group, the first one (the installation that had Excel before groups existed).
 * The records of other groups never go to the file and are never compared with it.
 */
const IN_EXCEL_GROUP = `(group_id IS NULL OR group_id = (SELECT id FROM groups ORDER BY created_at, id LIMIT 1))`;

/** Current record values as an Excel row snapshot (what was written to Excel after sync). */
const SNAPSHOT_OF_VALUES = `jsonb_build_object(
  'date', to_char(date, 'YYYY-MM-DD'), 'card', card, 'category', category, 'name', name, 'amount', amount)`;

const toMoney = (row: ExpenseRow): ExpenseMoney | null =>
  row.card_amount === null || row.reporting_amount === null
    ? null
    : {
        cardCurrency: row.card_currency!,
        cardAmount: row.card_amount,
        reportingCurrency: row.reporting_currency!,
        reportingAmount: row.reporting_amount,
      };

const toStored = (row: ExpenseRow): StoredExpense => ({
  id: row.id,
  groupId: row.group_id,
  date: row.date,
  card: row.card,
  category: row.category,
  name: row.name,
  amount: row.amount,
  source: row.source,
  excelStatus: row.excel_status,
  deletedAt: row.deleted_at,
  deletedReason: row.deleted_reason,
  excelSnapshot: row.excel_snapshot,
  original:
    row.original_amount === null
      ? null
      : {
          amount: row.original_amount,
          currency: row.original_currency!,
          rate: row.exchange_rate!,
        },
  money: toMoney(row),
});

/** Whether the record values match the Excel row. */
const sameValues = (a: Expense, b: Expense) =>
  a.date === b.date &&
  a.card === b.card &&
  a.category === b.category &&
  a.name === b.name &&
  a.amount === b.amount;

export class PostgresExpenseRepository implements ExpenseRepository {
  constructor(private readonly database: Database) {}

  async insertPending(
    db: SqlExecutor,
    expense: Expense,
    createdBy: string,
    original?: ExpenseOriginal,
    money?: ExpenseMoney,
  ): Promise<StoredExpense> {
    const [row] = await db.query<ExpenseRow>(
      `INSERT INTO expenses (
         id, date, card, category, name, amount, source, excel_status, created_by,
         original_amount, original_currency, exchange_rate,
         card_currency, card_amount, reporting_currency, reporting_amount
       ) VALUES ($1, $2, $3, $4, $5, $6, 'app', 'pending', $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        expense.date,
        expense.card,
        expense.category,
        expense.name,
        expense.amount,
        createdBy,
        original?.amount ?? null,
        original?.currency ?? null,
        original?.rate ?? null,
        money?.cardCurrency ?? null,
        money?.cardAmount ?? null,
        money?.reportingCurrency ?? null,
        money?.reportingAmount ?? null,
      ],
    );
    return toStored(row!);
  }

  async findById(id: string): Promise<StoredExpense | undefined> {
    const [row] = await this.database.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE id = $1`,
      [id],
    );
    return row && toStored(row);
  }

  async listCategories(scope?: ExpenseScope): Promise<string[]> {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const rows = await this.database.query<{ category: string }>(
      `SELECT category FROM expenses
        WHERE deleted_at IS NULL AND ${scope ? scopeCondition(scope, param) : 'true'}
        GROUP BY category ORDER BY min(seq), category`,
      params,
    );
    return rows.map((row) => row.category);
  }

  async listNameSuggestions(limit: number, scope?: ExpenseScope): Promise<NameSuggestion[]> {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const visible = scope ? scopeCondition(scope, param) : 'true';
    params.push(limit);
    return this.database.query<NameSuggestion>(
      // Show the spelling from the most recent record, but count case-insensitively
      `SELECT (array_agg(name ORDER BY seq DESC))[1] AS name, category, count(*)::int AS count
         FROM expenses
        WHERE deleted_at IS NULL AND ${visible}
        GROUP BY category, lower(btrim(name))
        ORDER BY count(*) DESC, max(seq) DESC
        LIMIT $${params.length}`,
      params,
    );
  }

  async listForReconcile(db: SqlExecutor): Promise<StoredExpense[]> {
    const rows = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE ${IN_EXCEL_GROUP} ORDER BY seq`,
    );
    return rows.map(toStored);
  }

  async listQueue(db: SqlExecutor): Promise<StoredExpense[]> {
    const rows = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE excel_status = 'pending' AND deleted_at IS NULL AND ${IN_EXCEL_GROUP} ORDER BY seq`,
    );
    return rows.map(toStored);
  }

  async countQueue(): Promise<number> {
    const [row] = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM expenses WHERE excel_status <> 'synced' AND deleted_at IS NULL AND ${IN_EXCEL_GROUP}`,
    );
    return row!.count;
  }

  /** Adds records found in Excel. In a single query so the first load of a large sheet is fast. */
  async importFromExcel(db: SqlExecutor, expenses: Expense[]): Promise<number> {
    if (expenses.length === 0) return 0;

    await db.query(
      `INSERT INTO expenses
         (id, date, card, category, name, amount, source, excel_status, excel_synced_at, created_by, excel_snapshot)
       SELECT gen_random_uuid(), d, c, k, n, a, 'excel', 'synced', now(), 'excel',
              jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'card', c, 'category', k, 'name', n, 'amount', a)
       FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::int[]) AS t(d, c, k, n, a)`,
      [
        expenses.map((e) => e.date),
        expenses.map((e) => e.card),
        expenses.map((e) => e.category),
        expenses.map((e) => e.name),
        expenses.map((e) => e.amount),
      ],
    );
    return expenses.length;
  }

  async markWriting(db: SqlExecutor, ids: string[]): Promise<void> {
    await this.setStatus(db, ids, 'writing');
  }

  async markSynced(db: SqlExecutor, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      `UPDATE expenses
       SET excel_status = 'synced', excel_synced_at = now(), excel_last_error = NULL, updated_at = now(),
           excel_snapshot = ${SNAPSHOT_OF_VALUES}
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async markSyncedAs(db: SqlExecutor, entries: { id: string; snapshot: Expense }[]): Promise<void> {
    for (const { id, snapshot } of entries) {
      await db.query(
        `UPDATE expenses
         SET excel_status = 'synced', excel_synced_at = now(), excel_last_error = NULL, updated_at = now(),
             excel_snapshot = $2::jsonb
         WHERE id = $1`,
        [id, JSON.stringify(snapshot)],
      );
    }
  }

  async markPending(db: SqlExecutor, ids: string[], error?: string): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      `UPDATE expenses
       SET excel_status = 'pending',
           excel_attempts = excel_attempts + CASE WHEN $2::text IS NULL THEN 0 ELSE 1 END,
           excel_last_error = $2,
           updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [ids, error ?? null],
    );
  }

  async markDeleted(db: SqlExecutor, ids: string[], reason: DeletedReason): Promise<void> {
    if (ids.length === 0) return;
    // The row was removed in Excel: there is no snapshot anymore. A delete in the app keeps the snapshot: the row still has to be removed
    await db.query(
      `UPDATE expenses
          SET deleted_at = now(), deleted_reason = $2, updated_at = now(),
              excel_snapshot = CASE WHEN $2 = 'excel' THEN NULL ELSE excel_snapshot END
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids, reason],
    );
  }

  async restoreDeleted(db: SqlExecutor, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      // The row came back to Excel with the same values: the snapshot equals the current values
      `UPDATE expenses
          SET deleted_at = NULL, deleted_reason = NULL, updated_at = now(),
              excel_snapshot = ${SNAPSHOT_OF_VALUES}
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async clearSnapshots(db: SqlExecutor, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      'UPDATE expenses SET excel_snapshot = NULL, updated_at = now() WHERE id = ANY($1::uuid[])',
      [ids],
    );
  }

  async setSnapshots(
    db: SqlExecutor,
    entries: { id: string; snapshot: Expense | null }[],
  ): Promise<void> {
    for (const { id, snapshot } of entries) {
      await db.query(
        'UPDATE expenses SET excel_snapshot = $2::jsonb, excel_synced_at = now(), updated_at = now() WHERE id = $1',
        [id, snapshot === null ? null : JSON.stringify(snapshot)],
      );
    }
  }

  /**
   * What needs to be done in Excel for records already there (snapshot is set):
   * replace the row if the record values differ from the snapshot, and remove the row of a deleted record.
   */
  async listExcelChanges(db: SqlExecutor): Promise<ExcelChanges> {
    const rows = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE excel_snapshot IS NOT NULL AND ${IN_EXCEL_GROUP} ORDER BY seq`,
    );
    const changes: ExcelChanges = { updates: [], removals: [] };

    for (const stored of rows.map(toStored)) {
      const snapshot = stored.excelSnapshot!;
      if (stored.deletedAt !== null) {
        changes.removals.push({ id: stored.id, snapshot });
      } else if (!sameValues(stored, snapshot)) {
        const { date, card, category, name, amount } = stored;
        changes.updates.push({
          id: stored.id,
          from: snapshot,
          to: { date, card, category, name, amount },
        });
      }
    }
    return changes;
  }

  /** The record under a lock for the duration of an edit: two concurrent edits will not overwrite each other. */
  async findForUpdate(db: SqlExecutor, id: string): Promise<StoredExpense | undefined> {
    const [row] = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return row && toStored(row);
  }

  /** New record values. Resets the original foreign-currency amount if `clearOriginal`: it no longer matches the amount. */
  async updateValues(
    db: SqlExecutor,
    id: string,
    values: Expense,
    by: string,
    clearOriginal: boolean,
    money?: ExpenseMoney,
  ): Promise<void> {
    await db.query(
      `UPDATE expenses
          SET date = $2, card = $3, category = $4, name = $5, amount = $6,
              card_currency = COALESCE($9, card_currency),
              card_amount = COALESCE($10, card_amount),
              reporting_currency = COALESCE($11, reporting_currency),
              reporting_amount = COALESCE($12, reporting_amount),
              original_amount = CASE WHEN $8 THEN NULL ELSE original_amount END,
              original_currency = CASE WHEN $8 THEN NULL ELSE original_currency END,
              exchange_rate = CASE WHEN $8 THEN NULL ELSE exchange_rate END,
              updated_by = $7, updated_at = now()
        WHERE id = $1`,
      [
        id,
        values.date,
        values.card,
        values.category,
        values.name,
        values.amount,
        by,
        clearOriginal,
        money?.cardCurrency ?? null,
        money?.cardAmount ?? null,
        money?.reportingCurrency ?? null,
        money?.reportingAmount ?? null,
      ],
    );
  }

  /** Delete in the app: the record stays in the database, and sync will remove its row from Excel. */
  async markDeletedByApp(db: SqlExecutor, id: string, by: string): Promise<void> {
    await this.markDeleted(db, [id], 'app');
    await db.query('UPDATE expenses SET updated_by = $2 WHERE id = $1', [id, by]);
  }

  /**
   * Restoring a deleted record. If its row has not been removed from Excel yet (a snapshot exists), the record simply stays there;
   * if it has already been removed, the record is queued for adding again.
   */
  async restoreByApp(db: SqlExecutor, id: string, by: string): Promise<void> {
    await db.query(
      `UPDATE expenses
          SET deleted_at = NULL, deleted_reason = NULL, updated_by = $2, updated_at = now(),
              excel_status = CASE WHEN excel_snapshot IS NULL THEN 'pending' ELSE excel_status END
        WHERE id = $1`,
      [id, by],
    );
  }

  async recordChange(
    db: SqlExecutor,
    change: {
      expenseId: string;
      by: string;
      action: 'update' | 'delete' | 'restore';
      before: unknown;
      after: unknown;
    },
  ): Promise<void> {
    await db.query(
      `INSERT INTO expense_changes (expense_id, changed_by, action, before, after)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        change.expenseId,
        change.by,
        change.action,
        JSON.stringify(change.before),
        JSON.stringify(change.after),
      ],
    );
  }

  private async setStatus(db: SqlExecutor, ids: string[], status: ExcelStatus): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      'UPDATE expenses SET excel_status = $2, updated_at = now() WHERE id = ANY($1::uuid[])',
      [ids, status],
    );
  }
}
