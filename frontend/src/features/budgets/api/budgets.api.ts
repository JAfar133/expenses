import { apiRequest } from '../../../shared/api/http.ts';

export type PeriodKind = 'month' | 'month_from_day' | 'week';

/** A spending limit with its progress for the current period; amounts are in the reporting currency. */
export interface Budget {
  id: string;
  /** null: the overall limit of the group */
  categoryId: string | null;
  category: string | null;
  limit: number;
  periodKind: PeriodKind;
  periodDay: number | null;
  period: { from: string; to: string };
  spent: number;
  /** Negative when over the limit */
  remaining: number;
  /** May exceed 100 */
  percent: number;
  level: 'ok' | 'warn' | 'over';
  /** The currency of `limit`, `spent` and `remaining` (the requested one, else the reporting currency); `percent` and `level` are always in the reporting currency */
  currency: string;
}

export interface BudgetInput {
  categoryId: string | null;
  limit: number;
  periodKind: PeriodKind;
  periodDay?: number;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/** Limits with progress; `currency` asks the server for the amounts in another currency (default: the reporting one). */
export const fetchBudgets = async (currency?: string) =>
  (
    await apiRequest<Budget[]>(
      `/budgets${currency ? `?currency=${encodeURIComponent(currency)}` : ''}`,
    )
  ).data;

export const createBudget = (input: BudgetInput) =>
  apiRequest<{ id: string }>('/group/budgets', { method: 'POST', ...json(input) });

/** The category of a limit cannot change. */
export const updateBudget = (
  id: string,
  input: Pick<BudgetInput, 'limit' | 'periodKind' | 'periodDay'>,
) => apiRequest(`/group/budgets/${id}`, { method: 'PUT', ...json(input) });

export const deleteBudget = (id: string) =>
  apiRequest(`/group/budgets/${id}`, { method: 'DELETE' });
