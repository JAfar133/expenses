import { apiRequest } from '../../../shared/api/http.ts';
import { toSearch, type AnalyticsFilters } from './analytics.api.ts';

/**
 * Как запись соотносится со строкой в Excel:
 *   synced          идентична, синхронизация прошла
 *   pending-add     в Excel ещё нет, ждёт в очереди на добавление
 *   pending-update  исправлена, в Excel прежняя строка: ждёт обновления
 *   pending-remove  удалена, но строка ещё в Excel: ждёт удаления
 *   removed         удалена в приложении, строка из Excel убрана
 *   missing         удалена, потому что строку убрали в самом Excel
 */
export type ExcelState =
  'synced' | 'pending-add' | 'pending-update' | 'pending-remove' | 'removed' | 'missing';

export interface OperationItem {
  id: string;
  date: string;
  card: string;
  category: string;
  name: string;
  /** Сумма в драммах */
  amount: number;
  /** Валюта ввода; пустая исходная валюта означает базовую (AMD) */
  currency: string;
  original: { amount: number; currency: string; rate: number } | null;
  createdBy: string;
  source: 'app' | 'excel';
  excelState: ExcelState;
  /** Причина задержки записи в Excel (код ошибки), если была */
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

/** Что можно править в записи. */
export interface ExpensePatch {
  date?: string;
  card?: string;
  category?: string;
  name?: string;
  /** Целая сумма в драммах */
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
