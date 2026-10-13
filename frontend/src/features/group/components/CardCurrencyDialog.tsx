import { useState } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { updateCard, type GroupCard } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { toErrorMessage } from '../model/error-message.ts';
import { compactSelectClass } from './styles.ts';

/** The currency of a card; the server refuses once the card has records (its message stays in the window). */
export function CardCurrencyDialog({
  card,
  currencies,
  onClose,
}: {
  card: GroupCard;
  currencies: string[];
  onClose: () => void;
}) {
  const [currency, setCurrency] = useState(card.currency);
  const update = useGroupMutation((code: string) => updateCard(card.id, { currency: code }));

  async function save() {
    if (currency === card.currency) return onClose();
    try {
      await update.mutateAsync(currency);
      onClose();
    } catch {
      // The message is shown in the window
    }
  }

  return (
    <Modal title={`Валюта карты: ${card.name}`} onClose={onClose}>
      <div className="space-y-4">
        <select
          aria-label={`Валюта: ${card.name}`}
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className={`${compactSelectClass} h-12 w-full`}
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {update.isError && <Notice variant="error">{toErrorMessage(update.error)}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => void save()}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
