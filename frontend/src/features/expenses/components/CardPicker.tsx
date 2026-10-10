import type { UseFormRegisterReturn } from 'react-hook-form';

interface CardPickerProps {
  cards: string[];
  registration: UseFormRegisterReturn;
}

/** Выбор карты крупными кнопками: удобно нажимать одной рукой. */
export function CardPicker({ cards, registration }: CardPickerProps) {
  return (
    <div role="radiogroup" aria-label="Карта" className="grid grid-cols-2 gap-3">
      {cards.map((card) => (
        <label
          key={card}
          className={
            'group flex h-12 cursor-pointer items-center justify-center gap-1.5 rounded-xl border ' +
            'border-zinc-300 bg-white text-base font-medium dark:border-zinc-700 dark:bg-zinc-900 ' +
            'has-checked:border-indigo-600 has-checked:bg-indigo-600 has-checked:text-white ' +
            'has-focus-visible:ring-2 has-focus-visible:ring-indigo-500/40'
          }
        >
          <input type="radio" value={card} className="sr-only" {...registration} />
          {card}
          <span aria-hidden="true" className="hidden group-has-checked:inline">
            ✓
          </span>
        </label>
      ))}
    </div>
  );
}
