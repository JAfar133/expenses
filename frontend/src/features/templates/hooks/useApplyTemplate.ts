import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { deleteExpense } from '../../analytics/api/operations.api.ts';
import { createExpense } from '../../expenses/api/expenses.api.ts';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { invalidateAfterCreate } from '../../expenses/hooks/useCreateExpense.ts';
import { isBrowserOnline } from '../../../shared/hooks/useOnlineStatus.ts';
import { todayIso } from '../../../shared/utils/date.ts';
import { formatMoney } from '../../../shared/utils/money.ts';
import { newRequestId } from '../../../shared/utils/request-id.ts';
import type { Template } from '../api/templates.api.ts';

export interface TemplateNotice {
  kind: 'added' | 'info' | 'error';
  text: string;
  /** The created expense: «Отменить» deletes it */
  expenseId?: string;
}

/**
 * Tapping a template. With an amount the expense is created at once (today, in the user's time zone) and the
 * notice offers «Отменить»; without an amount, or without a network, the form is filled in instead (`onFill`),
 * so a missing amount is typed and the offline queue of the form takes over.
 */
export function useApplyTemplate(onFill: (template: Template) => void) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<TemplateNotice>();
  const busy = useRef(false);

  const apply = async (template: Template) => {
    if (template.amount === null || !isBrowserOnline()) return onFill(template);
    if (busy.current) return;
    busy.current = true;
    try {
      const created = await createExpense(
        {
          date: todayIso(),
          card: template.effectiveCard,
          category: template.category,
          name: template.expenseName,
          amount: template.amount,
          ...(template.currency ? { currency: template.currency } : {}),
        },
        newRequestId(),
      );
      invalidateAfterCreate(queryClient);
      const shown = created.original ?? { amount: created.amount, currency: created.currency };
      setNotice({
        kind: 'added',
        text: `Добавлено · ${template.name} · ${formatMoney(shown.amount)} ${shown.currency ?? ''}`.trim(),
        expenseId: created.id,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: toSaveErrorMessage(error) });
    } finally {
      busy.current = false;
    }
  };

  const undo = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
      invalidateAfterCreate(queryClient);
      setNotice({ kind: 'info', text: 'Расход отменён' });
    } catch {
      setNotice({
        kind: 'error',
        text: 'Не удалось отменить. Расход можно удалить в «Операциях»',
      });
    }
  };

  return { apply, undo, notice, dismiss: () => setNotice(undefined) };
}
