import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SYNC_STATE_KEY } from '../../sync/hooks/useSyncState.ts';
import { createExpense, type CreateExpenseRequest } from '../api/expenses.api.ts';
import { NAME_SUGGESTIONS_KEY } from './useNameSuggestions.ts';

interface CreateExpenseVariables {
  expense: CreateExpenseRequest;
  idempotencyKey: string;
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    // Повторы отключены: запись не должна уходить повторно без решения пользователя
    retry: false,
    mutationFn: ({ expense, idempotencyKey }: CreateExpenseVariables) =>
      createExpense(expense, idempotencyKey),
    onSuccess: () => {
      // Новая категория могла появиться в справочнике, а очередь Excel — измениться
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: NAME_SUGGESTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: SYNC_STATE_KEY });
    },
  });
}
