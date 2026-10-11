import type { SqlExecutor } from '../infrastructure/database/database.ts';
import type { Expense } from '../services/excel/types.ts';

export type { Expense };

/** pending — ждёт записи в Excel, writing — запись начата, synced — запись есть в Excel. */
export type ExcelStatus = 'pending' | 'writing' | 'synced';

export type DeletedReason = 'excel' | 'app';

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
  /** Кто удалил: excel (строку убрали в Excel) или app (удалили в приложении); null у активных записей */
  deletedReason: DeletedReason | null;
  /** Как строка выглядит в Excel сейчас; null, если записи в Excel нет (см. миграцию 0005) */
  excelSnapshot: Expense | null;
  /** Исходная сумма в иностранной валюте; null для расходов в драммах и записей из Excel */
  original: ExpenseOriginal | null;
}

/** Как часто в категории встречается наименование (без учёта регистра и пробелов по краям). */
export interface NameSuggestion {
  name: string;
  category: string;
  count: number;
}

/** Изменения Excel, которые нужны для записей, уже лежащих в Excel. */
export interface ExcelChanges {
  /** Заменить строку: `from` — как она выглядит в Excel, `to` — как должна выглядеть */
  updates: { id: string; from: Expense; to: Expense }[];
  /** Убрать строку удалённой записи */
  removals: { id: string; snapshot: Expense }[];
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
  markDeleted(db: SqlExecutor, ids: string[], reason: DeletedReason): Promise<void>;
  /** Снимает пометку удаления (строка вернулась в Excel). */
  restoreDeleted(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Забывает снимок: строки записи в Excel больше нет. */
  clearSnapshots(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Запоминает, как строки записей выглядят в Excel (null: строки нет). */
  setSnapshots(db: SqlExecutor, entries: { id: string; snapshot: Expense | null }[]): Promise<void>;
  listExcelChanges(db: SqlExecutor): Promise<ExcelChanges>;
  findForUpdate(db: SqlExecutor, id: string): Promise<StoredExpense | undefined>;
  updateValues(
    db: SqlExecutor,
    id: string,
    values: Expense,
    by: string,
    clearOriginal: boolean,
  ): Promise<void>;
  markDeletedByApp(db: SqlExecutor, id: string, by: string): Promise<void>;
  restoreByApp(db: SqlExecutor, id: string, by: string): Promise<void>;
  recordChange(
    db: SqlExecutor,
    change: {
      expenseId: string;
      by: string;
      action: 'update' | 'delete' | 'restore';
      before: unknown;
      after: unknown;
    },
  ): Promise<void>;
  /** Возвращает записи в очередь; `error` и счётчик попыток нужны, чтобы видеть причину задержки. */
  markPending(db: SqlExecutor, ids: string[], error?: string): Promise<void>;
}
