import type { Option } from '../hooks/useFilterOptions.ts';

interface ToggleChipsProps {
  /** What is being chosen, for screen readers */
  label: string;
  options: Option[];
  selected: string[];
  /** Values left out («all except»); a value is never both selected and excluded */
  excluded: string[];
  onChange: (change: { selected: string[]; excluded: string[] }) => void;
}

const without = (values: string[], value: string) => values.filter((item) => item !== value);

/**
 * Multi-select with label buttons: pressing a chip toggles the value, the small «×» on it excludes the value
 * (an excluded chip is struck through and red; pressing it brings the value back).
 * A selected or excluded value missing from the list is shown too.
 */
export function ToggleChips({ label, options, selected, excluded, onChange }: ToggleChipsProps) {
  const known = new Set(options.map((option) => option.value));
  const all = [
    ...options,
    ...[...selected, ...excluded]
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: value })),
  ];

  const toggle = (value: string) =>
    onChange({
      selected: selected.includes(value) ? without(selected, value) : [...selected, value],
      excluded: without(excluded, value),
    });
  const exclude = (value: string) =>
    onChange({ selected: without(selected, value), excluded: [...excluded, value] });
  const restore = (value: string) => onChange({ selected, excluded: without(excluded, value) });

  if (all.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Нет вариантов</p>;
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {all.map((option) => {
        if (excluded.includes(option.value)) {
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`Вернуть: ${option.label}`}
              title="Вернуть"
              onClick={() => restore(option.value)}
              className="flex h-9 items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-3.5 text-sm text-red-700 transition hover:border-red-400 active:scale-95 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              <span className="line-through">{option.label}</span>
              <span aria-hidden="true">↺</span>
            </button>
          );
        }
        const active = selected.includes(option.value);
        return (
          <span
            key={option.value}
            className={
              'inline-flex h-9 items-center rounded-full border text-sm transition ' +
              (active
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-zinc-300 bg-white text-zinc-700 hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200')
            }
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={() => toggle(option.value)}
              className="h-full rounded-l-full pl-3.5 pr-1.5 active:scale-95"
            >
              {option.label}
            </button>
            <button
              type="button"
              aria-label={`Исключить: ${option.label}`}
              title="Исключить"
              onClick={() => exclude(option.value)}
              className="h-full rounded-r-full pl-1 pr-2.5 text-xs opacity-60 hover:opacity-100"
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
