import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchBudgets } from '../api/budgets.api.ts';

/** Common key prefix: invalidating it refreshes the limits in every currency. */
export const BUDGETS_KEY = ['budgets'];

/**
 * Limits with progress. Without `currency` the amounts are in the reporting currency; with it the server
 * converts them (the currency is part of the key, so switching refetches and the old bars stay while loading).
 * Invalidated after expenses change and after the owner edits limits.
 */
export function useBudgets(currency?: string) {
  return useQuery({
    queryKey: [...BUDGETS_KEY, currency ?? null],
    queryFn: () => fetchBudgets(currency),
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}
