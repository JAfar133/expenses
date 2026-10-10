import type { SqlExecutor } from '../infrastructure/database/database.ts';
import type { Expense } from '../services/excel/types.ts';

export type { Expense };

/** pending — ждёт записи в Excel, writing — запись начата, synced — запись есть в Excel. */
export type ExcelStatus = 'pending' | 'writing' | 'synced';

export interface StoredExpense extends Expense {
  id: string;
  source: 'app' | 'excel';
  excelStatus: ExcelStatus;
}

/** Хранилище расходов (PostgreSQL). Excel — отдельное зеркало, см. модуль sync. */
export interface ExpenseRepository {
  insertPending(db: SqlExecutor, expense: Expense, createdBy: string): Promise<StoredExpense>;
  findById(id: string): Promise<StoredExpense | undefined>;
  listCategories(): Promise<string[]>;

  /** Все записи для сверки с Excel. */
  listForReconcile(db: SqlExecutor): Promise<StoredExpense[]>;
  /** Записи, которые нужно дописать в Excel, от старых к новым. */
  listQueue(db: SqlExecutor): Promise<StoredExpense[]>;
  countQueue(): Promise<number>;

  importFromExcel(db: SqlExecutor, expenses: Expense[]): Promise<number>;
  markWriting(db: SqlExecutor, ids: string[]): Promise<void>;
  markSynced(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Возвращает записи в очередь; `error` и счётчик попыток нужны, чтобы видеть причину задержки. */
  markPending(db: SqlExecutor, ids: string[], error?: string): Promise<void>;
}
