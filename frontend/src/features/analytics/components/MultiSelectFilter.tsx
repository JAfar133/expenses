import { useId, useState } from 'react';
import { ChevronDownIcon } from '../../../shared/ui/icons.tsx';
import type { Option } from '../hooks/useFilterOptions.ts';
import {
  checkedValues,
  excludeValue,
  restoreValue,
  selectionSummary,
  toggleValue,
  type MultiSelection,
} from '../model/multi-select.ts';

/** With more values than this the list has a search field. */
const SEARCH_FROM = 8;

interface MultiSelectFilterProps {
  /** «Карты», «Категории»: the title of the filter */
  label: string;
  /** «Все карты»: what the button says while nothing restricts */
  allText: string;
  options: Option[];
  value: MultiSelection;
  onChange: (value: MultiSelection) => void;
}

/**
 * «Карты: Все карты ▾»: a button that opens a list with checkboxes. Ticking everything is no restriction.
 * Every item can also be excluded («все, кроме») with the small «×»; an excluded item is red and struck through.
 */
export function MultiSelectFilter({
  label,
  allText,
  options,
  value,
  onChange,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();

  // A selected or excluded value missing from the options stays visible and can be removed
  const known = new Set(options.map((option) => option.value));
  const all = [
    ...options,
    ...[...value.selected, ...value.excluded]
      .filter((item) => !known.has(item))
      .map((item) => ({ value: item, label: item })),
  ];
  const values = all.map((option) => option.value);
  const checked = checkedValues(values, value);
  const shown = all.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-label={`${label}: ${selectionSummary(all, value, allText)}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 text-left text-sm hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <span className="text-zinc-500 dark:text-zinc-400">{label}: </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {selectionSummary(all, value, allText)}
        </span>
        <span aria-hidden="true" className={`text-zinc-400 transition ${open ? 'rotate-180' : ''}`}>
          <ChevronDownIcon />
        </span>
      </button>

      <div id={listId} role="group" aria-label={label} hidden={!open}>
        {open && (
          <div className="space-y-2 rounded-xl border border-zinc-100 p-2 dark:border-zinc-800">
            {all.length > SEARCH_FROM && (
              <input
                type="search"
                aria-label={`Поиск: ${label}`}
                placeholder="Поиск"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              />
            )}
            {all.length === 0 && <p className="px-1 text-sm text-zinc-500">Нет вариантов</p>}
            <ul className="max-h-56 overflow-y-auto">
              {shown.map((option) => {
                const excluded = value.excluded.includes(option.value);
                return (
                  <li key={option.value} className="flex items-center gap-1">
                    {excluded ? (
                      <button
                        type="button"
                        aria-label={`Вернуть: ${option.label}`}
                        title="Вернуть"
                        onClick={() => onChange(restoreValue(value, option.value))}
                        className="flex min-h-10 flex-1 items-center gap-3 rounded-lg px-2 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        <span className="w-5 text-center" aria-hidden="true">
                          ↺
                        </span>
                        <span className="line-through">{option.label}</span>
                      </button>
                    ) : (
                      <>
                        <label className="flex min-h-10 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <input
                            type="checkbox"
                            checked={checked.includes(option.value)}
                            onChange={() => onChange(toggleValue(values, value, option.value))}
                            className="size-5 accent-indigo-600"
                          />
                          {option.label}
                        </label>
                        <button
                          type="button"
                          aria-label={`Исключить: ${option.label}`}
                          title="Исключить"
                          onClick={() => onChange(excludeValue(value, option.value))}
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 w-full rounded-lg bg-zinc-100 text-sm font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              Готово
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
