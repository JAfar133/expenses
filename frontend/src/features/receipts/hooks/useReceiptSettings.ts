import { useQuery } from '@tanstack/react-query';
import { fetchReceiptSettings } from '../api/receipts.api.ts';

export const RECEIPT_SETTINGS_KEY = ['receipt-settings'];

export function useReceiptSettings() {
  return useQuery({
    queryKey: RECEIPT_SETTINGS_KEY,
    queryFn: fetchReceiptSettings,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Whether a photo may be attached to an expense of the category: the feature is on and the category is chosen. */
export function useReceiptAllowed(category: string | undefined): boolean {
  const settings = useReceiptSettings().data;
  return !!settings?.enabled && !!category && settings.categories.includes(category);
}
