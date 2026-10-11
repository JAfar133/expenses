import { randomUUID } from 'node:crypto';
import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { dateText, timestampText } from '../../infrastructure/database/sql.ts';
import type {
  Expense,
  ExpenseRepository,
  ExcelStatus,
  DeletedReason,
  ExcelChanges,
  ExpenseOriginal,
  NameSuggestion,
  StoredExpense,
} from '../expense.repository.ts';

interface ExpenseRow {
  id: string;
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
}

const COLUMNS = `id, ${dateText('date')} AS date, card, category, name, amount, source, excel_status, ${timestampText('deleted_at')} AS deleted_at, deleted_reason, excel_snapshot, original_amount::float8 AS original_amount, original_currency, exchange_rate::float8 AS exchange_rate`;

/** Текущие значения записи в виде снимка строки Excel (то, что записано в Excel после синхронизации). */
const SNAPSHOT_OF_VALUES = `jsonb_build_object(
  'date', to_char(date, 'YYYY-MM-DD'), 'card', card, 'category', category, 'name', name, 'amount', amount)`;

const toStored = (row: ExpenseRow): StoredExpense => ({
  id: row.id,
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
});

/** Совпадают ли значения записи со строкой Excel. */
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
  ): Promise<StoredExpense> {
    const [row] = await db.query<ExpenseRow>(
      `INSERT INTO expenses (
         id, date, card, category, name, amount, source, excel_status, created_by,
         original_amount, original_currency, exchange_rate
       ) VALUES ($1, $2, $3, $4, $5, $6, 'app', 'pending', $7, $8, $9, $10)
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

  async listCategories(): Promise<string[]> {
    const rows = await this.database.query<{ category: string }>(
      'SELECT category FROM expenses WHERE deleted_at IS NULL GROUP BY category ORDER BY min(seq), category',
    );
    return rows.map((row) => row.category);
  }

  async listNameSuggestions(limit: number): Promise<NameSuggestion[]> {
    return this.database.query<NameSuggestion>(
      // Показываем написание из самой свежей записи, а считаем без учёта регистра
      `SELECT (array_agg(name ORDER BY seq DESC))[1] AS name, category, count(*)::int AS count
         FROM expenses
        WHERE deleted_at IS NULL
        GROUP BY category, lower(btrim(name))
        ORDER BY count(*) DESC, max(seq) DESC
        LIMIT $1`,
      [limit],
    );
  }

  async listForReconcile(db: SqlExecutor): Promise<StoredExpense[]> {
    const rows = await db.query<ExpenseRow>(`SELECT ${COLUMNS} FROM expenses ORDER BY seq`);
    return rows.map(toStored);
  }

  async listQueue(db: SqlExecutor): Promise<StoredExpense[]> {
    const rows = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE excel_status = 'pending' AND deleted_at IS NULL ORDER BY seq`,
    );
    return rows.map(toStored);
  }

  async countQueue(): Promise<number> {
    const [row] = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM expenses WHERE excel_status <> 'synced' AND deleted_at IS NULL`,
    );
    return row!.count;
  }

  /** Добавляет записи, найденные в Excel. Одним запросом, чтобы первая загрузка большой таблицы была быстрой. */
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
    // Строку убрали в Excel: снимка больше нет. Удаление в приложении снимок сохраняет: строку ещё предстоит убрать
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
      // Строка вернулась в Excel с теми же значениями: снимок равен текущим значениям
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
   * Что нужно сделать с Excel для записей, которые в нём уже есть (снимок задан):
   * заменить строку, если значения записи отличаются от снимка, и убрать строку удалённой записи.
   */
  async listExcelChanges(db: SqlExecutor): Promise<ExcelChanges> {
    const rows = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE excel_snapshot IS NOT NULL ORDER BY seq`,
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

  /** Запись под блокировкой на время правки: две одновременные правки не перепишут друг друга. */
  async findForUpdate(db: SqlExecutor, id: string): Promise<StoredExpense | undefined> {
    const [row] = await db.query<ExpenseRow>(
      `SELECT ${COLUMNS} FROM expenses WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return row && toStored(row);
  }

  /** Новые значения записи. Исходную сумму в валюте сбрасывает, если `clearOriginal`: она больше не соответствует сумме. */
  async updateValues(
    db: SqlExecutor,
    id: string,
    values: Expense,
    by: string,
    clearOriginal: boolean,
  ): Promise<void> {
    await db.query(
      `UPDATE expenses
          SET date = $2, card = $3, category = $4, name = $5, amount = $6,
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
      ],
    );
  }

  /** Удаление в приложении: запись остаётся в базе, а её строку из Excel уберёт синхронизация. */
  async markDeletedByApp(db: SqlExecutor, id: string, by: string): Promise<void> {
    await this.markDeleted(db, [id], 'app');
    await db.query('UPDATE expenses SET updated_by = $2 WHERE id = $1', [id, by]);
  }

  /**
   * Возврат удалённой записи. Если её строка ещё не убрана из Excel (снимок есть), запись просто остаётся там;
   * если уже убрана, запись снова встаёт в очередь на добавление.
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
