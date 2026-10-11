import type { ReactNode } from 'react';
import { useFilterOptions } from '../hooks/useFilterOptions.ts';
import { usePersistentChoice } from '../hooks/usePersistentChoice.ts';
import { activeFilterCount, type FilterState } from '../model/filter-state.ts';
import { ActiveFilters } from './ActiveFilters.tsx';
import { DebouncedInput } from './DebouncedInput.tsx';
import { PeriodPicker } from './PeriodPicker.tsx';
import { ToggleChips } from './ToggleChips.tsx';

interface FilterPanelProps {
  state: FilterState;
  today: string;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  /** Показывать выбор периода; у сравнения месяцев период свой */
  showPeriod?: boolean;
}

const OPEN_STATES = ['open', 'closed'] as const;

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</div>
      {children}
    </div>
  );
}

const amountOrUndefined = (text: string) =>
  /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;

/** Общая панель фильтров страницы анализа: период сверху, остальные условия раскрываются кнопкой «Фильтры». */
export function FilterPanel({
  state,
  today,
  onChange,
  onReset,
  showPeriod = true,
}: FilterPanelProps) {
  const [openState, setOpenState] = usePersistentChoice('filters.panel', OPEN_STATES, 'closed');
  const open = openState === 'open';
  const options = useFilterOptions();
  const count = activeFilterCount(state);

  return (
    <section
      aria-label="Фильтры"
      className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"
    >
      {showPeriod && <PeriodPicker state={state} today={today} onChange={onChange} />}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="filter-fields"
          onClick={() => setOpenState(open ? 'closed' : 'open')}
          className="flex h-9 items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-indigo-400 dark:border-zinc-700"
        >
          Фильтры
          {count > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">
              {count}
            </span>
          )}
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        <ActiveFilters
          state={state}
          authors={options.authors}
          onChange={onChange}
          onReset={onReset}
        />
      </div>

      {open && (
        <div id="filter-fields" className="grid gap-4 sm:grid-cols-2">
          <FieldGroup label="Карты">
            <ToggleChips
              label="Карты"
              options={options.cards}
              selected={state.cards}
              onChange={(cards) => onChange({ cards })}
            />
          </FieldGroup>
          <FieldGroup label="Кто добавил">
            <ToggleChips
              label="Кто добавил"
              options={options.authors}
              selected={state.createdBy}
              onChange={(createdBy) => onChange({ createdBy })}
            />
          </FieldGroup>
          <div className="sm:col-span-2">
            <FieldGroup label="Категории">
              <ToggleChips
                label="Категории"
                options={options.categories}
                selected={state.categories}
                onChange={(categories) => onChange({ categories })}
              />
            </FieldGroup>
          </div>
          <FieldGroup label="Валюта ввода">
            <ToggleChips
              label="Валюта ввода"
              options={options.currencies}
              selected={state.currencies}
              onChange={(currencies) => onChange({ currencies })}
            />
          </FieldGroup>
          <FieldGroup label="Наименование содержит">
            <DebouncedInput
              type="search"
              aria-label="Поиск по наименованию"
              placeholder="Например, латте"
              autoComplete="off"
              maxLength={100}
              value={state.q}
              onCommit={(q) => onChange({ q: q.trim() })}
            />
          </FieldGroup>
          <FieldGroup label="Сумма, от и до">
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
          </FieldGroup>
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={state.includeDeleted}
              onChange={(event) => onChange({ includeDeleted: event.target.checked })}
              className="size-5 accent-indigo-600"
            />
            Показывать удалённые записи (пропавшие из Excel)
          </label>
        </div>
      )}
    </section>
  );
}
