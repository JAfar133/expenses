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
import { ANALYTICS_KEY } from './useAnalytics.ts';

/** Список операций с сортировкой и страницами; прежняя страница остаётся на экране, пока грузится новая. */
export const useOperations = (filters: AnalyticsFilters, query: ListQuery) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'operations', query, filters],
    queryFn: () => fetchOperations(filters, query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

/** Правка, удаление и возврат записи. После любого действия данные анализа и очередь Excel обновляются. */
export function useExpenseActions() {
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY }),
      queryClient.invalidateQueries({ queryKey: SYNC_STATE_KEY }),
      queryClient.invalidateQueries({ queryKey: NAME_SUGGESTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
    ]);

  // Повторы выключены: правка не должна уходить дважды без решения пользователя
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
