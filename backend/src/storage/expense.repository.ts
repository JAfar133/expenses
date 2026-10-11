import type { SqlExecutor } from '../infrastructure/database/database.ts';
import type { Expense } from '../services/excel/types.ts';

export type { Expense };

/** pending — ждёт записи в Excel, writing — запись начата, synced — запись есть в Excel. */
export type ExcelStatus = 'pending' | 'writing' | 'synced';

/** Расход в иностранной валюте: исходная сумма и курс на момент ввода (amount при этом в драммах). */
export interface ExpenseOriginal {
  amount: number;
  currency: string;
  /** Драммы за единицу валюты */
  rate: number;
}

export interface StoredExpense extends Expense {
  id: string;
  source: 'app' | 'excel';
  excelStatus: ExcelStatus;
  /** Когда запись помечена удалённой (ISO) или null, если она активна */
  deletedAt: string | null;
  /** Исходная сумма в иностранной валюте; null для расходов в драммах и записей из Excel */
  original: ExpenseOriginal | null;
}

/** Как часто в категории встречается наименование (без учёта регистра и пробелов по краям). */
export interface NameSuggestion {
  name: string;
  category: string;
  count: number;
}

/** Хранилище расходов (PostgreSQL). Excel — отдельное зеркало, см. модуль sync. */
export interface ExpenseRepository {
  insertPending(
    db: SqlExecutor,
    expense: Expense,
    createdBy: string,
    original?: ExpenseOriginal,
  ): Promise<StoredExpense>;
  findById(id: string): Promise<StoredExpense | undefined>;
  listCategories(): Promise<string[]>;
  /** Наименования по категориям от самых частых к редким (не больше limit). */
  listNameSuggestions(limit: number): Promise<NameSuggestion[]>;

  /** Все записи для сверки с Excel, включая помеченные удалёнными. */
  listForReconcile(db: SqlExecutor): Promise<StoredExpense[]>;
  /** Записи, которые нужно дописать в Excel, от старых к новым. */
  listQueue(db: SqlExecutor): Promise<StoredExpense[]>;
  countQueue(): Promise<number>;

  importFromExcel(db: SqlExecutor, expenses: Expense[]): Promise<number>;
  markWriting(db: SqlExecutor, ids: string[]): Promise<void>;
  markSynced(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Помечает записи удалёнными (мягкое удаление): из базы они не пропадают. */
  markDeleted(db: SqlExecutor, ids: string[], reason: 'excel'): Promise<void>;
  /** Снимает пометку удаления. */
  restoreDeleted(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Возвращает записи в очередь; `error` и счётчик попыток нужны, чтобы видеть причину задержки. */
  markPending(db: SqlExecutor, ids: string[], error?: string): Promise<void>;
}
