import { useQuery } from '@tanstack/react-query';
import { fetchBudgets } from '../api/budgets.api.ts';

export const BUDGETS_KEY = ['budgets'];

/** Limits with progress. Invalidated after expenses change and after the owner edits limits. */
export function useBudgets() {
  return useQuery({
    queryKey: BUDGETS_KEY,
    queryFn: fetchBudgets,
    staleTime: 60_000,
    retry: false,
  });
}
