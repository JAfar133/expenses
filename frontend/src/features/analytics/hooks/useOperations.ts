import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NAME_SUGGESTIONS_KEY } from '../../expenses/hooks/useNameSuggestions.ts';
import { SYNC_STATE_KEY } from '../../sync/hooks/useSyncState.ts';
import type { AnalyticsFilters } from '../api/analytics.api.ts';
import {
  deleteExpense,
  fetchOperations,
  patchExpense,
  restoreExpense,
  type ExpensePatch,
  type ListQuery,
} from '../api/operations.api.ts';
import { BUDGETS_KEY } from '../../budgets/hooks/useBudgets.ts';
import { ANALYTICS_KEY } from './useAnalytics.ts';

/** Operations list with sorting and pages; the previous page stays on screen while a new one loads. */
export const useOperations = (filters: AnalyticsFilters, query: ListQuery) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'operations', query, filters],
    queryFn: () => fetchOperations(filters, query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

/** Edit, delete and restore of a record. After any action analytics data and the Excel queue are refreshed. */
export function useExpenseActions() {
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY }),
      queryClient.invalidateQueries({ queryKey: SYNC_STATE_KEY }),
      queryClient.invalidateQueries({ queryKey: BUDGETS_KEY }),
      queryClient.invalidateQueries({ queryKey: NAME_SUGGESTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
    ]);

  // Retries disabled: an edit must not be sent twice without the user's decision
  const update = useMutation({
    retry: false,
    mutationFn: ({ id, patch }: { id: string; patch: ExpensePatch }) => patchExpense(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation({
    retry: false,
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: refresh,
  });
  const restore = useMutation({
    retry: false,
    mutationFn: (id: string) => restoreExpense(id),
    onSuccess: refresh,
  });

  return { update, remove, restore };
}
