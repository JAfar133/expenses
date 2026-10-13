import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveReceiptSettings } from '../api/receipts.api.ts';
import { RECEIPT_SETTINGS_KEY } from './useReceiptSettings.ts';

/** Saves the receipt settings of the group (owner) and refreshes them. */
export function useSaveReceiptSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: saveReceiptSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECEIPT_SETTINGS_KEY }),
  });
}
