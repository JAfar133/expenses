import type { SqlExecutor } from '../infrastructure/database/database.ts';
import type { Expense } from '../services/excel/types.ts';

export type { Expense };

/** pending — waiting to be written to Excel, writing — write started, synced — the record is in Excel. */
export type ExcelStatus = 'pending' | 'writing' | 'synced';

export type DeletedReason = 'excel' | 'app';

/** Expense in a foreign currency: the original amount and the rate at entry time (amount is in drams). */
export interface ExpenseOriginal {
  amount: number;
  currency: string;
  /** Drams per unit of currency */
  rate: number;
}

export interface StoredExpense extends Expense {
  id: string;
  source: 'app' | 'excel';
  excelStatus: ExcelStatus;
  /** When the record was marked deleted (ISO), or null if it is active */
  deletedAt: string | null;
  /** Who deleted it: excel (the row was removed in Excel) or app (deleted in the app); null for active records */
  deletedReason: DeletedReason | null;
  /** How the row currently looks in Excel; null if the record is not in Excel (see migration 0005) */
  excelSnapshot: Expense | null;
  /** Original amount in the foreign currency; null for dram expenses and records from Excel */
  original: ExpenseOriginal | null;
}

/** How often a name occurs in a category (case-insensitive, ignoring surrounding whitespace). */
export interface NameSuggestion {
  name: string;
  category: string;
  count: number;
}

/** Excel changes needed for records that are already in Excel. */
export interface ExcelChanges {
  /** Replace a row: `from` is how it looks in Excel, `to` is how it should look */
  updates: { id: string; from: Expense; to: Expense }[];
  /** Remove the row of a deleted record */
  removals: { id: string; snapshot: Expense }[];
}

/** Expense storage (PostgreSQL). Excel is a separate mirror, see the sync module. */
export interface ExpenseRepository {
  insertPending(
    db: SqlExecutor,
    expense: Expense,
    createdBy: string,
    original?: ExpenseOriginal,
  ): Promise<StoredExpense>;
  findById(id: string): Promise<StoredExpense | undefined>;
  listCategories(): Promise<string[]>;
  /** Names per category from most to least frequent (at most limit). */
  listNameSuggestions(limit: number): Promise<NameSuggestion[]>;

  /** All records for reconciliation with Excel, including those marked deleted. */
  listForReconcile(db: SqlExecutor): Promise<StoredExpense[]>;
  /** Records that need to be appended to Excel, oldest first. */
  listQueue(db: SqlExecutor): Promise<StoredExpense[]>;
  countQueue(): Promise<number>;

  importFromExcel(db: SqlExecutor, expenses: Expense[]): Promise<number>;
  markWriting(db: SqlExecutor, ids: string[]): Promise<void>;
  markSynced(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Marks records as written to Excel with exactly the values that were sent (they may have been edited since). */
  markSyncedAs(db: SqlExecutor, entries: { id: string; snapshot: Expense }[]): Promise<void>;
  /** Marks records as deleted (soft delete): they are not removed from the database. */
  markDeleted(db: SqlExecutor, ids: string[], reason: DeletedReason): Promise<void>;
  /** Clears the deletion mark (the row is back in Excel). */
  restoreDeleted(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Forgets the snapshot: the record's row is no longer in Excel. */
  clearSnapshots(db: SqlExecutor, ids: string[]): Promise<void>;
  /** Remembers how record rows look in Excel (null: there is no row). */
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
  /** Puts records back in the queue; `error` and the attempt counter are needed to see the reason for the delay. */
  markPending(db: SqlExecutor, ids: string[], error?: string): Promise<void>;
}
