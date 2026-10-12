import type { UseFormRegisterReturn } from 'react-hook-form';
import type { Card } from '../api/expenses.api.ts';

interface CardPickerProps {
  cards: Card[];
  registration: UseFormRegisterReturn;
}

/** Card picker with large buttons: easy to tap with one hand. */
export function CardPicker({ cards, registration }: CardPickerProps) {
  // Currencies are shown only when the cards differ in them: with one currency there is nothing to tell apart
  const mixed = new Set(cards.map((card) => card.currency)).size > 1;

  return (
    <div role="radiogroup" aria-label="Карта" className="grid grid-cols-2 gap-3">
      {cards.map((card) => (
        <label
          key={card.name}
          className={
            'group flex h-12 cursor-pointer items-center justify-center gap-1.5 rounded-xl border ' +
            'border-zinc-300 bg-white text-base font-medium dark:border-zinc-700 dark:bg-zinc-900 ' +
            'has-checked:border-indigo-600 has-checked:bg-indigo-600 has-checked:text-white ' +
            'has-focus-visible:ring-2 has-focus-visible:ring-indigo-500/40'
          }
        >
          <input type="radio" value={card.name} className="sr-only" {...registration} />
          {card.name}
          {mixed && (
            <span aria-hidden="true" className="text-xs font-normal opacity-70">
              {card.currency}
            </span>
          )}
          <span aria-hidden="true" className="hidden group-has-checked:inline">
            ✓
          </span>
        </label>
      ))}
    </div>
  );
}
