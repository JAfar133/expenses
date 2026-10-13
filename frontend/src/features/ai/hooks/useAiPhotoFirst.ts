import { useReceiptSettings } from '../../receipts/hooks/useReceiptSettings.ts';
import { useAiAvailable } from './useAiStatus.ts';

/**
 * Can a receipt be loaded before any category is chosen: the AI is on, photos are on, and at least one category
 * allows both a photo and the AI (the AI then picks the category itself).
 */
export function useAiPhotoFirst(): boolean {
  const available = useAiAvailable();
  const settings = useReceiptSettings().data;
  if (!available || !settings?.enabled) return false;
  return settings.categories.some(
    (name) => settings.aiCategories === undefined || settings.aiCategories.includes(name),
  );
}
