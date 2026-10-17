import { useState, type FormEvent } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../model/error-message.ts';
import { compactInputClass } from './styles.ts';

const INVALID = 'Укажите последние четыре цифры карты';

/** «Последние 4 цифры карты»: they let bank notifications find this card. Empty clears them. */
export function CardDigitsDialog({
  cardName,
  initial,
  onSubmit,
  onClose,
}: {
  cardName: string;
  initial: string | null;
  /** Resolves when saved; `null` clears the digits */
  onSubmit: (last4: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (value !== '' && !/^\d{4}$/.test(value)) return setError(INVALID);
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(value === '' ? null : value);
      onClose();
    } catch (failure) {
      setError(toErrorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Цифры карты: ${cardName}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Последние 4 цифры карты
          </span>
          <input
            autoFocus
            aria-label="Последние 4 цифры карты"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={value}
            aria-invalid={error !== undefined}
            onChange={(event) => {
              setValue(event.target.value.replace(/\D/g, '').slice(0, 4));
              setError(undefined);
            }}
            className={`${compactInputClass} h-12 w-full font-mono`}
          />
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Нужны, чтобы расходы из банка попадали на эту карту
          </span>
        </label>
        {error && <Notice variant="error">{error}</Notice>}
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
            disabled={busy}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
