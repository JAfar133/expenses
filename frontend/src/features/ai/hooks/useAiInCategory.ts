import { useReceiptSettings } from '../../receipts/hooks/useReceiptSettings.ts';
import { useAiAvailable } from './useAiStatus.ts';

/**
 * May the AI read the receipt of this category: it is on for the group, the photo is allowed in the category and the
 * owner did not switch the AI off there. A server that does not know the list means «all categories».
 */
export function useAiInCategory(category: string | undefined): boolean {
  const available = useAiAvailable();
  const settings = useReceiptSettings().data;
  if (!available || !settings?.enabled || !category) return false;
  return (
    settings.categories.includes(category) &&
    (settings.aiCategories === undefined || settings.aiCategories.includes(category))
  );
}
