import type { Option } from '../hooks/useFilterOptions.ts';

interface ToggleChipsProps {
  /** Что выбираем, для скринридера */
  label: string;
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

/** Мультивыбор кнопками-метками: нажатие включает и выключает значение. Выбранное, которого нет в списке, тоже показывается. */
export function ToggleChips({ label, options, selected, onChange }: ToggleChipsProps) {
  const known = new Set(options.map((option) => option.value));
  const all = [
    ...options,
    ...selected.filter((value) => !known.has(value)).map((value) => ({ value, label: value })),
  ];

  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );

  if (all.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Нет вариантов</p>;
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {all.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option.value)}
            className={
              'h-9 rounded-full border px-3.5 text-sm transition active:scale-95 ' +
              (active
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-zinc-300 bg-white text-zinc-700 hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200')
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
