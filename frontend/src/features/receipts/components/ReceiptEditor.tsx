import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { deleteReceipt, receiptUrl, uploadReceipt } from '../api/receipts.api.ts';
import { usePhotoFile } from '../hooks/usePhotoFile.ts';
import { PhotoInput } from './PhotoInput.tsx';

interface ReceiptEditorProps {
  expenseId: string;
  hasReceipt: boolean;
  /** A photo may be attached to this record (the feature is on for its category) */
  allowed: boolean;
}

const buttonClass =
  'h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700';

/** The photo of a record inside the edit window: show it, replace, remove, or attach one. */
export function ReceiptEditor({ expenseId, hasReceipt, allowed }: ReceiptEditorProps) {
  const queryClient = useQueryClient();
  const [has, setHas] = useState(hasReceipt);
  const [version, setVersion] = useState(0);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });

  const upload = useMutation({
    retry: false,
    mutationFn: (photo: Blob) => uploadReceipt(expenseId, photo),
    onSuccess: () => {
      setHas(true);
      setVersion((value) => value + 1);
      return refresh();
    },
  });
  const remove = useMutation({
    retry: false,
    mutationFn: () => deleteReceipt(expenseId),
    onSuccess: () => {
      setHas(false);
      return refresh();
    },
  });
  const file = usePhotoFile(async (photo) => {
    await upload.mutateAsync(photo);
  });

  if (!has && !allowed) return null;
  const failure = [upload, remove].find((mutation) => mutation.isError)?.error;
  const message = file.error ?? (failure instanceof Error ? failure.message : undefined);
  const busy = file.busy || remove.isPending;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Фото чека</div>
      <PhotoInput inputRef={file.input} onChange={(event) => void file.onChange(event)} />
      {has && (
        <img
          src={receiptUrl(expenseId, version)}
          alt="Фото чека"
          className="max-h-48 rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
      )}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={file.open} className={buttonClass}>
          {has ? 'Заменить' : 'Прикрепить'}
        </button>
        {has && (
          <button
            type="button"
            disabled={busy}
            onClick={() => remove.mutate()}
            className={`${buttonClass} text-red-600 dark:text-red-400`}
          >
            Убрать
          </button>
        )}
      </div>
      {message && <p className="text-sm text-red-600 dark:text-red-400">{message}</p>}
    </div>
  );
}
