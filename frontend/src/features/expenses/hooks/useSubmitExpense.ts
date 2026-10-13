import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { isBrowserOnline } from '../../../shared/hooks/useOnlineStatus.ts';
import { queueStore } from '../../offline-queue/model/queue-store.ts';
import { isQueueable } from '../../offline-queue/model/queue-sync.ts';
import { nextCreatedAt } from '../../offline-queue/model/created-at.ts';
import { QueueUnavailableError } from '../../offline-queue/model/queue-types.ts';
import { uploadReceipt } from '../../receipts/api/receipts.api.ts';
import {
  createExpense,
  type CreatedExpense,
  type CreateExpenseRequest,
} from '../api/expenses.api.ts';
import { toSaveErrorMessage } from '../api/save-error-message.ts';
import { startReceiptParse } from '../../ai/model/parse-runner.ts';
import { invalidateAfterCreate } from './useCreateExpense.ts';

export type SubmitState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'sent'; created: CreatedExpense; photoFailed: boolean }
  | { status: 'queued' }
  | { status: 'error'; message: string };

/** What happened to a submit: the form clears itself on `sent` and `queued`, and keeps the values otherwise. */
export type SubmitResult = 'sent' | 'queued' | 'error' | 'busy';

export const QUEUED_MESSAGE = 'Сохранено на устройстве, отправится при появлении сети';

/**
 * Saves an expense: sends it, or (no network, no answer, a gateway error) puts it into the queue on the device
 * under the same idempotency key. An answer with an error of the server is shown and is never queued.
 * A second submit while one is in progress does nothing.
 */
export function useSubmitExpense() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const busy = useRef(false);

  const enqueue = async (
    expense: CreateExpenseRequest,
    idempotencyKey: string,
    photo: Blob | null,
    parse: boolean,
  ) => {
    await queueStore.add({
      id: idempotencyKey,
      expense,
      ...(photo ? { photo } : {}),
      ...(photo && parse ? { parse } : {}),
      createdAt: nextCreatedAt(),
      status: 'pending',
      attempts: 0,
    });
  };

  const submit = useCallback(
    async (
      expense: CreateExpenseRequest,
      idempotencyKey: string,
      photo: Blob | null,
      /** Parse the receipt with the AI once the photo is uploaded */
      parse = false,
    ): Promise<SubmitResult> => {
      if (busy.current) return 'busy';
      busy.current = true;
      setState({ status: 'pending' });

      const queue = async (fallbackMessage?: string): Promise<SubmitResult> => {
        try {
          await enqueue(expense, idempotencyKey, photo, parse);
          setState({ status: 'queued' });
          return 'queued';
        } catch (error) {
          const message =
            fallbackMessage ??
            (error instanceof QueueUnavailableError
              ? error.message
              : 'Не удалось сохранить на устройстве, попробуйте позже');
          setState({ status: 'error', message });
          return 'error';
        }
      };

      try {
        if (!isBrowserOnline()) return await queue();

        try {
          const created = await createExpense(expense, idempotencyKey);
          invalidateAfterCreate(queryClient);
          let photoFailed = false;
          if (photo) {
            // The expense is saved already: a failed upload must not undo or block anything
            photoFailed = await uploadReceipt(created.id, photo).then(
              () => false,
              () => true,
            );
            // In the background: the next expense can be typed meanwhile
            if (parse && !photoFailed) void startReceiptParse(created.id, queryClient);
          }
          setState({ status: 'sent', created, photoFailed });
          return 'sent';
        } catch (error) {
          if (isQueueable(error)) {
            // If the device cannot store it, the usual message about an unknown outcome is the honest one
            return await queue(toSaveErrorMessage(error));
          }
          setState({ status: 'error', message: toSaveErrorMessage(error) });
          return 'error';
        }
      } finally {
        busy.current = false;
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, submit, reset };
}
