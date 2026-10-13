import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/http.ts';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { parseReceipt } from '../api/ai.api.ts';
import { beginParse, endParse } from './parse-state.ts';

export const ITEMS_KEY = (expenseId: string) => ['items', expenseId];

/** The reason shown after «Не удалось разобрать чек, заполните вручную». */
export function parseFailureMessage(error: unknown): string {
  const reason = error instanceof ApiError ? error.message : '';
  return `Не удалось разобрать чек, заполните вручную${reason ? `. ${reason}` : ''}`;
}

/**
 * Starts the parsing of a saved receipt in the background and returns at once with a promise nobody has to wait for:
 * the status is in `parse-state`. A failure never touches the saved expense.
 */
export async function startReceiptParse(
  expenseId: string,
  queryClient: QueryClient,
): Promise<void> {
  beginParse(expenseId);
  try {
    const result = await parseReceipt(expenseId);
    const filled = result.nameFilled || result.dateFilled || result.itemsFilled;
    endParse(expenseId, {
      kind: 'ok',
      message: filled ? 'Название, дата и позиции заполнены ИИ' : 'Чек разобран, новых данных нет',
    });
  } catch (error) {
    endParse(expenseId, { kind: 'error', message: parseFailureMessage(error) });
  }
  // The lists show what the AI filled in
  void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });
  void queryClient.invalidateQueries({ queryKey: ITEMS_KEY(expenseId) });
}
