import type { UseFormRegisterReturn } from 'react-hook-form';
import { inputClassName } from '../../../shared/ui/Field.tsx';
import { SelectBox, selectPadding } from '../../../shared/ui/SelectBox.tsx';
import { knownFlag } from '../../../shared/utils/currency-flags.ts';
import type { Card } from '../api/expenses.api.ts';

interface CardSelectProps {
  cards: Card[];
  registration: UseFormRegisterReturn;
  invalid?: boolean;
}

/** «🇦🇲 Visa Digital · AMD»: the flag, the name and the currency code of a card. */
export const cardLabel = (card: Card) =>
  `${knownFlag(card.currency) ? `${knownFlag(card.currency)} ` : ''}${card.name} · ${card.currency}`;

/**
 * The card is one native select (on a phone: the system wheel) showing «🇦🇲 Visa Digital · AMD».
 * With a single card there is nothing to choose: it is shown as plain text and its value is still submitted.
 */
export function CardSelect({ cards, registration, invalid = false }: CardSelectProps) {
  if (cards.length === 1) {
    const [only] = cards as [Card];
    return (
      <>
        <input type="hidden" value={only.name} {...registration} />
        <div
          aria-label="Карта"
          role="group"
          className="flex h-12 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {cardLabel(only)}
        </div>
      </>
    );
  }

  return (
    <SelectBox>
      <select
        id="card"
        aria-label="Карта"
        aria-invalid={invalid}
        className={`${inputClassName} ${selectPadding}`}
        {...registration}
      >
        {cards.map((card) => (
          <option key={card.name} value={card.name}>
            {cardLabel(card)}
          </option>
        ))}
      </select>
    </SelectBox>
  );
}
