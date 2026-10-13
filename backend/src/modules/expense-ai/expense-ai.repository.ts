import type { SqlExecutor } from '../../infrastructure/database/database.ts';
import type { FieldSource } from './plan-receipt.ts';

export interface AiExpenseState {
  name: string;
  nameSource: FieldSource;
  date: string;
  dateSource: FieldSource;
  aiProcessedAt: string | null;
}

/** The AI marks of an expense: where its name and date came from, and whether its receipt was parsed. */
export class ExpenseAiRepository {
  /** Locks the expense and reads its current values. */
  async lock(db: SqlExecutor, id: string): Promise<AiExpenseState | undefined> {
    const [row] = await db.query<{
      name: string;
      name_source: FieldSource;
      date: string;
      date_source: FieldSource;
      ai_processed_at: string | null;
    }>(
      `SELECT name, name_source, date::text AS date, date_source, ai_processed_at::text AS ai_processed_at
         FROM expenses WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return (
      row && {
        name: row.name,
        nameSource: row.name_source,
        date: row.date,
        dateSource: row.date_source,
        aiProcessedAt: row.ai_processed_at,
      }
    );
  }

  /**
   * Writes what the AI filled and marks the expense as processed. Only the database changes: the Excel sync notices
   * the difference with the row snapshot (like after any edit).
   */
  async applyReceipt(
    db: SqlExecutor,
    id: string,
    change: { name?: string; date?: string; model: string },
  ): Promise<void> {
    await db.query(
      `UPDATE expenses
          SET name = COALESCE($2, name),
              name_source = CASE WHEN $2::text IS NULL THEN name_source ELSE 'ai' END,
              date = COALESCE($3::date, date),
              date_source = CASE WHEN $3::text IS NULL THEN date_source ELSE 'ai' END,
              ai_processed_at = now(),
              ai_model = $4,
              updated_by = 'ai', updated_at = now()
        WHERE id = $1`,
      [id, change.name ?? null, change.date ?? null, change.model],
    );
  }

  /** A new expense whose values came from a receipt parsed in the form. */
  async markCreated(
    db: SqlExecutor,
    id: string,
    marks: { nameIsAi: boolean; dateIsAi: boolean; model: string },
  ): Promise<void> {
    await db.query(
      `UPDATE expenses
          SET name_source = CASE WHEN $2 THEN 'ai' ELSE name_source END,
              date_source = CASE WHEN $3 THEN 'ai' ELSE date_source END,
              ai_processed_at = now(), ai_model = $4
        WHERE id = $1`,
      [id, marks.nameIsAi, marks.dateIsAi, marks.model],
    );
  }

  /** The values the AI wrote stay, but stop being marked as generated: the person accepted them. */
  async adoptGenerated(db: SqlExecutor, id: string): Promise<void> {
    await db.query(
      `UPDATE expenses
          SET name_source = CASE WHEN name_source = 'ai' THEN 'manual' ELSE name_source END,
              date_source = CASE WHEN date_source = 'ai' THEN 'manual' ELSE date_source END
        WHERE id = $1`,
      [id],
    );
  }
}
