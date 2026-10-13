import { useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../model/error-message.ts';
import { compactInputClass } from './styles.ts';

interface NameDialogProps {
  title: string;
  /** The accessible name of the field */
  label: string;
  initial?: string;
  submitLabel: string;
  /** More fields between the name and the buttons (e.g. a currency) */
  extra?: ReactNode;
  /** Resolves when saved: the dialog closes; a rejection is shown in the dialog */
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}

/** A small window with one name field: a new category or card, a rename. Errors of the server stay in the window. */
export function NameDialog({
  title,
  label,
  initial = '',
  submitLabel,
  extra,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <input
          autoFocus
          aria-label={label}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`${compactInputClass} h-12 w-full`}
        />
        {extra}
        {error != null && <Notice variant="error">{toErrorMessage(error)}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy || name.trim() === ''}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
