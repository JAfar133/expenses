import type { UseFormRegisterReturn } from 'react-hook-form';
import { flagOf } from '../../../shared/utils/currency-flags.ts';
import type { Card } from '../api/expenses.api.ts';
import { CheckIcon } from '../../../shared/ui/icons.tsx';

interface CardPickerProps {
  cards: Card[];
  registration: UseFormRegisterReturn;
}

/**
 * Card picker with large buttons: easy to tap with one hand. Every card shows its currency (flag and code).
 * The chosen card is filled and has a check mark in the corner.
 */
export function CardPicker({ cards, registration }: CardPickerProps) {
  return (
    <div role="radiogroup" aria-label="Карта" className="grid grid-cols-2 gap-3">
      {cards.map((card) => (
        <label
          key={card.name}
          className={
            'group relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 ' +
            'rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-center shadow-sm transition ' +
            'hover:border-indigo-300 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 ' +
            'has-checked:border-indigo-600 has-checked:bg-indigo-600 has-checked:text-white ' +
            'has-checked:shadow-md has-focus-visible:ring-2 has-focus-visible:ring-indigo-500/40'
          }
        >
          <input type="radio" value={card.name} className="sr-only" {...registration} />
          <span className="text-base font-semibold leading-tight">{card.name}</span>
          <span
            aria-hidden="true"
            className={
              'inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium ' +
              'text-zinc-600 group-has-checked:bg-white/20 group-has-checked:text-white ' +
              'dark:bg-zinc-800 dark:text-zinc-300'
            }
          >
            <span>{flagOf(card.currency)}</span>
            {card.currency}
          </span>
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 hidden size-4 items-center justify-center group-has-checked:flex"
          >
            <CheckIcon />
          </span>
        </label>
      ))}
    </div>
  );
}
