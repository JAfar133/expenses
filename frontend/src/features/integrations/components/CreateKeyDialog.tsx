import { useState, type FormEvent } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { compactInputClass } from '../../group/components/styles.ts';

export const DEFAULT_KEY_NAME = 'iPhone — IDBank';

/** Asks for the name of a new API key. */
export function CreateKeyDialog({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: unknown;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(DEFAULT_KEY_NAME);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && !busy) onSubmit(name.trim());
  };
  return (
    <Modal title="Новый API-ключ" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Название ключа
          </span>
          <input
            autoFocus
            aria-label="Название ключа"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${compactInputClass} h-12 w-full`}
          />
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Чтобы потом понять, с какого телефона или автоматизации пришли расходы
          </span>
        </label>
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
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}
