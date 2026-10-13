import type { ReactNode } from 'react';
import type { FilterState } from '../model/filter-state.ts';
import type { useFilterOptions } from '../hooks/useFilterOptions.ts';
import { DebouncedInput } from './DebouncedInput.tsx';
import { MultiSelectFilter } from './MultiSelectFilter.tsx';

interface FilterSheetProps {
  state: FilterState;
  options: ReturnType<typeof useFilterOptions>;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</div>
      {children}
    </div>
  );
}

const amountOrUndefined = (text: string) =>
  /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;

/** The content of the filters panel: four multi-select filters, the name search, the amounts and two switches. */
export function FilterSheet({ state, options, onChange, onReset, onClose }: FilterSheetProps) {
  return (
    <div className="space-y-4">
      <MultiSelectFilter
        label="Карты"
        allText="Все карты"
        options={options.cards}
        value={{ selected: state.cards, excluded: state.excludeCards }}
        onChange={({ selected, excluded }) => onChange({ cards: selected, excludeCards: excluded })}
      />
      <MultiSelectFilter
        label="Кто добавил"
        allText="Все"
        options={options.authors}
        value={{ selected: state.createdBy, excluded: state.excludeCreatedBy }}
        onChange={({ selected, excluded }) =>
          onChange({ createdBy: selected, excludeCreatedBy: excluded })
        }
      />
      <MultiSelectFilter
        label="Категории"
        allText="Все категории"
        options={options.categories}
        value={{ selected: state.categories, excluded: state.excludeCategories }}
        onChange={({ selected, excluded }) =>
          onChange({ categories: selected, excludeCategories: excluded })
        }
      />
      <MultiSelectFilter
        label="Валюта ввода"
        allText="Все"
        options={options.currencies}
        value={{ selected: state.currencies, excluded: state.excludeCurrencies }}
        onChange={({ selected, excluded }) =>
          onChange({ currencies: selected, excludeCurrencies: excluded })
        }
      />

      <Field label="Наименование содержит">
        <DebouncedInput
          type="search"
          aria-label="Поиск по наименованию"
          placeholder="Например, латте"
          autoComplete="off"
          maxLength={100}
          value={state.q}
          onCommit={(q) => onChange({ q: q.trim() })}
        />
      </Field>
      <Field label="Сумма, от и до">
        <div className="flex items-center gap-2">
          <DebouncedInput
            inputMode="numeric"
            aria-label="Сумма от"
            placeholder="от"
            autoComplete="off"
            value={state.minAmount === undefined ? '' : String(state.minAmount)}
            onCommit={(text) => onChange({ minAmount: amountOrUndefined(text) })}
          />
          <span aria-hidden="true" className="text-zinc-400">
            –
          </span>
          <DebouncedInput
            inputMode="numeric"
            aria-label="Сумма до"
            placeholder="до"
            autoComplete="off"
            value={state.maxAmount === undefined ? '' : String(state.maxAmount)}
            onCommit={(text) => onChange({ maxAmount: amountOrUndefined(text) })}
          />
        </div>
      </Field>

      {options.hasArchive && (
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={state.includeArchived}
            onChange={(event) => onChange({ includeArchived: event.target.checked })}
            className="size-5 accent-indigo-600"
          />
          Показывать архив
        </label>
      )}
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={state.includeDeleted}
          onChange={(event) => onChange({ includeDeleted: event.target.checked })}
          className="size-5 accent-indigo-600"
        />
        Показывать удалённые записи (пропавшие из Excel)
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onReset}
          className="h-11 flex-1 rounded-xl border border-zinc-300 text-sm font-medium dark:border-zinc-700"
        >
          Сбросить
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Показать
        </button>
      </div>
    </div>
  );
}
