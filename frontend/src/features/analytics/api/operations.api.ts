import { apiRequest, downloadFile } from '../../../shared/api/http.ts';
import { toSearch, type AnalyticsFilters } from './analytics.api.ts';

/**
 * How a record relates to its Excel row:
 * synced          identical, sync went through
 * pending-add     not in Excel yet, waiting in the add queue
 * pending-update  edited, Excel has the old row: waiting for an update
 * pending-remove  deleted, but the row is still in Excel: waiting for removal
 * removed         deleted in the app, the row is removed from Excel
 * missing         deleted because the row was removed in Excel itself
 */
export type ExcelState =
  'synced' | 'pending-add' | 'pending-update' | 'pending-remove' | 'removed' | 'missing';

export interface OperationItem {
  id: string;
  date: string;
  card: string;
  category: string;
  name: string;
  /** Amount in the currency of the card */
  amount: number;
  /** Currency of the card */
  currency: string;
  /** The same expense in the requested display currency (`currency=` of the request) */
  displayAmount?: number;
  /** The same expense in the reporting currency of the group */
  reportingAmount?: number;
  reportingCurrency?: string;
  /** What was typed, if its currency differed from the card's */
  original: { amount: number; currency: string; rate: number } | null;
  /** May the current user edit or delete this record (owner: any live record; member: own, window open, card access) */
  /** The record has a photo of a receipt */
  hasReceipt?: boolean;
  /** How many receipt positions the record has, and how many of them the AI generated */
  itemsCount?: number;
  aiItemsCount?: number;
  /** Where the name and the date came from: `ai` means generated and not changed by a person */
  nameSource?: 'default' | 'manual' | 'ai';
  dateSource?: 'default' | 'manual' | 'ai';
  /** The receipt was parsed by the AI (stays true even after the person corrected everything) */
  aiProcessed?: boolean;
  editable: boolean;
  /** Members only: when the window to edit this record closes; null otherwise */
  editableUntil: string | null;
  createdAt?: string;
  createdBy: string;
  source: 'app' | 'excel';
  excelState: ExcelState;
  /** Reason the Excel write was delayed (error code), if any */
  excelError: string | null;
  deletedAt: string | null;
  deletedReason: 'excel' | 'app' | null;
  updatedBy: string | null;
}

export interface OperationsPage {
  items: OperationItem[];
  total: number;
  /** In the reporting currency */
  totalAmount: number;
}

export const SORT_COLUMNS = ['date', 'card', 'category', 'name', 'amount', 'createdBy'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = 'asc' | 'desc';

export interface ListQuery {
  sort: SortColumn;
  direction: SortDirection;
  limit: number;
  offset: number;
}

export const fetchOperations = async (filters: AnalyticsFilters, query: ListQuery) =>
  (await apiRequest<OperationsPage>(`/expenses${toSearch(filters, { ...query })}`)).data;

/** What can be edited in a record. */
export interface ExpensePatch {
  date?: string;
  card?: string;
  category?: string;
  name?: string;
  /** Amount in the currency of the card: whole in drams, otherwise at most 2 decimals */
  amount?: number;
}

export interface EditedExpense {
  id: string;
  deletedAt: string | null;
  excelState: ExcelState;
}

export const patchExpense = async (id: string, patch: ExpensePatch) =>
  (
    await apiRequest<EditedExpense>(`/expenses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  ).data;

export const deleteExpense = async (id: string) =>
  (await apiRequest<EditedExpense>(`/expenses/${id}`, { method: 'DELETE' })).data;

export const restoreExpense = async (id: string) =>
  (await apiRequest<EditedExpense>(`/expenses/${id}/restore`, { method: 'POST' })).data;

/** The report for the same filters and display currency as the list (no paging or sorting), as an .xlsx download. */
export const downloadExport = (filters: AnalyticsFilters) =>
  downloadFile(`/expenses/export.xlsx${toSearch(filters)}`, 'expenses.xlsx');
