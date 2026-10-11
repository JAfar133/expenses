import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SYNC_STATE_KEY } from '../../sync/hooks/useSyncState.ts';
import { createExpense, type CreateExpenseRequest } from '../api/expenses.api.ts';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { NAME_SUGGESTIONS_KEY } from './useNameSuggestions.ts';

interface CreateExpenseVariables {
  expense: CreateExpenseRequest;
  idempotencyKey: string;
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    // Retries disabled: a record must not be resent without the user's decision
    retry: false,
    mutationFn: ({ expense, idempotencyKey }: CreateExpenseVariables) =>
      createExpense(expense, idempotencyKey),
    onSuccess: () => {
      // A new category may have appeared in the reference data, and the Excel queue may have changed
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: NAME_SUGGESTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });
      void queryClient.invalidateQueries({ queryKey: SYNC_STATE_KEY });
    },
  });
}
