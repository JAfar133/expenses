import type { Expense } from '../services/excel/types.ts';

export type { Expense };

/** Абстракция хранилища расходов: сейчас Excel, позже PostgreSQL. */
export interface ExpenseRepository {
  create(expense: Expense): Promise<Expense>;
  listCategories(): Promise<string[]>;
}
