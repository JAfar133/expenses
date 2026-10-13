import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { ITEMS_KEY } from '../../ai/model/parse-runner.ts';
import { fetchItems, saveItems, type ItemInput } from '../api/items.api.ts';

/** Positions of an expense; loaded only when somebody looks (`enabled`). */
export function useItems(expenseId: string, enabled = true) {
  return useQuery({
    queryKey: ITEMS_KEY(expenseId),
    queryFn: () => fetchItems(expenseId),
    enabled,
    retry: false,
  });
}

export function useSaveItems(expenseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (items: ItemInput[]) => saveItems(expenseId, items),
    onSuccess: (saved) => {
      queryClient.setQueryData(ITEMS_KEY(expenseId), saved);
      // The counters in the list
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });
    },
  });
}
