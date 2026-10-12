import type { Database } from '../../infrastructure/database/database.ts';
import type { BudgetPeriodKind } from './period.ts';

export interface BudgetRow {
  id: string;
  categoryId: string | null;
  /** Name of the category; null for the overall limit of the group */
  category: string | null;
  limit: number;
  periodKind: BudgetPeriodKind;
  periodDay: number | null;
}

export interface BudgetInput {
  categoryId: string | null;
  limit: number;
  periodKind: BudgetPeriodKind;
  periodDay: number | null;
}

/** A limit for this category (or this overall limit) already exists. */
export class BudgetExistsError extends Error {}

/** SQL for the spending limits of a group. */
export class BudgetsRepository {
  constructor(private readonly database: Database) {}

  async list(groupId: string): Promise<BudgetRow[]> {
    const rows = await this.database.query<{
      id: string;
      category_id: string | null;
      category: string | null;
      limit_amount: number;
      period_kind: BudgetPeriodKind;
      period_day: number | null;
    }>(
      `SELECT b.id, b.category_id, c.name AS category, b.limit_amount::float8 AS limit_amount,
              b.period_kind, b.period_day
         FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.group_id = $1
        ORDER BY (b.category_id IS NOT NULL), c.position, c.name`,
      [groupId],
    );
    return rows.map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      category: row.category,
      limit: row.limit_amount,
      periodKind: row.period_kind,
      periodDay: row.period_day,
    }));
  }

  /** Whether the category (active) belongs to the group. */
  async categoryInGroup(groupId: string, categoryId: string): Promise<boolean> {
    const rows = await this.database.query(
      'SELECT 1 FROM categories WHERE id = $1 AND group_id = $2 AND archived_at IS NULL',
      [categoryId, groupId],
    );
    return rows.length > 0;
  }

  async create(groupId: string, input: BudgetInput): Promise<string> {
    return this.unique(async () => {
      const [row] = await this.database.query<{ id: string }>(
        `INSERT INTO budgets (group_id, category_id, limit_amount, period_kind, period_day)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [groupId, input.categoryId, input.limit, input.periodKind, input.periodDay],
      );
      return row!.id;
    });
  }

  /** Changes the limit and the period (the category stays); false if the group has no such budget. */
  async update(
    groupId: string,
    id: string,
    input: Pick<BudgetInput, 'limit' | 'periodKind' | 'periodDay'>,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `UPDATE budgets SET limit_amount = $3, period_kind = $4, period_day = $5, updated_at = now()
        WHERE id = $1 AND group_id = $2 RETURNING id`,
      [id, groupId, input.limit, input.periodKind, input.periodDay],
    );
    return rows.length > 0;
  }

  async remove(groupId: string, id: string): Promise<boolean> {
    const rows = await this.database.query(
      'DELETE FROM budgets WHERE id = $1 AND group_id = $2 RETURNING id',
      [id, groupId],
    );
    return rows.length > 0;
  }

  /** Multiplies all limits of the group (the reporting currency changed). */
  async scaleLimits(groupId: string, factor: number): Promise<void> {
    await this.database.query(
      'UPDATE budgets SET limit_amount = greatest(round(limit_amount * $2::numeric, 2), 0.01), updated_at = now() WHERE group_id = $1',
      [groupId, factor],
    );
  }

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new BudgetExistsError();
      throw error;
    }
  }
}
