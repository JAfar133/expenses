import { randomUUID } from 'node:crypto';
import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { dateText, timestampText } from '../../infrastructure/database/sql.ts';
import type {
  Expense,
  ExpenseRepository,
  ExcelStatus,
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
}

const COLUMNS = `id, ${dateText('date')} AS date, card, category, name, amount, source, excel_status, ${timestampText('deleted_at')} AS deleted_at`;

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
});

export class PostgresExpenseRepository implements ExpenseRepository {
  constructor(private readonly database: Database) {}

  async insertPending(
    db: SqlExecutor,
    expense: Expense,
    createdBy: string,
  ): Promise<StoredExpense> {
    const [row] = await db.query<ExpenseRow>(
      `INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'app', 'pending', $7)
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        expense.date,
        expense.card,
        expense.category,
        expense.name,
        expense.amount,
        createdBy,
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
      `SELECT ${COLUMNS} FROM expenses WHERE excel_status = 'pending' ORDER BY seq`,
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
         (id, date, card, category, name, amount, source, excel_status, excel_synced_at, created_by)
       SELECT gen_random_uuid(), d, c, k, n, a, 'excel', 'synced', now(), 'excel'
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
       SET excel_status = 'synced', excel_synced_at = now(), excel_last_error = NULL, updated_at = now()
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

  async markDeleted(db: SqlExecutor, ids: string[], reason: 'excel'): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      `UPDATE expenses SET deleted_at = now(), deleted_reason = $2, updated_at = now()
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids, reason],
    );
  }

  async restoreDeleted(db: SqlExecutor, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      `UPDATE expenses SET deleted_at = NULL, deleted_reason = NULL, updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [ids],
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
