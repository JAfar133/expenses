import { apiRequest } from '../../../shared/api/http.ts';
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
  /** Amount in drams */
  amount: number;
  /** Input currency; an empty original currency means the base (AMD) */
  currency: string;
  original: { amount: number; currency: string; rate: number } | null;
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
  /** Whole amount in drams */
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
