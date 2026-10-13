import { formatMoney } from '../../../shared/utils/money.ts';
import type { FilterState } from '../model/filter-state.ts';
import type { Option } from '../hooks/useFilterOptions.ts';

interface ActiveFiltersProps {
  state: FilterState;
  authors: Option[];
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}

interface Chip {
  id: string;
  text: string;
  clear: Partial<FilterState>;
}

/** Enabled filters are always visible, even when the panel is collapsed: each is removed with one press. */
export function ActiveFilters({ state, authors, onChange, onReset }: ActiveFiltersProps) {
  const authorLabel = (value: string) => authors.find((a) => a.value === value)?.label ?? value;
  const chips: Chip[] = [];

  if (state.cards.length) {
    chips.push({ id: 'cards', text: `Карты: ${state.cards.join(', ')}`, clear: { cards: [] } });
  }
  if (state.categories.length) {
    chips.push({
      id: 'categories',
      text: `Категории: ${state.categories.join(', ')}`,
      clear: { categories: [] },
    });
  }
  if (state.createdBy.length) {
    chips.push({
      id: 'createdBy',
      text: `Кто: ${state.createdBy.map(authorLabel).join(', ')}`,
      clear: { createdBy: [] },
    });
  }
  if (state.currencies.length) {
    chips.push({
      id: 'currencies',
      text: `Валюта: ${state.currencies.join(', ')}`,
      clear: { currencies: [] },
    });
  }
  const exceptions: [string, string[], Partial<FilterState>][] = [
    ['exceptCards', state.excludeCards, { excludeCards: [] }],
    ['exceptCategories', state.excludeCategories, { excludeCategories: [] }],
    ['exceptCreatedBy', state.excludeCreatedBy.map(authorLabel), { excludeCreatedBy: [] }],
    ['exceptCurrencies', state.excludeCurrencies, { excludeCurrencies: [] }],
  ];
  for (const [id, values, clear] of exceptions) {
    if (values.length) chips.push({ id, text: `Кроме: ${values.join(', ')}`, clear });
  }
  if (state.q) chips.push({ id: 'q', text: `Поиск: «${state.q}»`, clear: { q: '' } });
  if (state.minAmount !== undefined || state.maxAmount !== undefined) {
    const from = state.minAmount === undefined ? '' : `от ${formatMoney(state.minAmount)}`;
    const to = state.maxAmount === undefined ? '' : `до ${formatMoney(state.maxAmount)}`;
    chips.push({
      id: 'amount',
      text: `Сумма ${[from, to].filter(Boolean).join(' ')}`,
      clear: { minAmount: undefined, maxAmount: undefined },
    });
  }
  if (state.includeArchived) {
    chips.push({ id: 'archive', text: 'С архивом', clear: { includeArchived: false } });
  }
  if (state.includeDeleted) {
    chips.push({ id: 'deleted', text: 'С удалёнными', clear: { includeDeleted: false } });
  }

  if (chips.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Включённые фильтры">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button
            type="button"
            onClick={() => onChange(chip.clear)}
            aria-label={`Убрать фильтр: ${chip.text}`}
            className="flex h-8 items-center gap-1.5 rounded-full bg-indigo-50 px-3 text-sm text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
          >
            <span className="max-w-60 truncate">{chip.text}</span>
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onReset}
          className="h-8 rounded-full px-3 text-sm font-medium text-indigo-600 hover:bg-zinc-200/60 dark:text-indigo-400 dark:hover:bg-zinc-800"
        >
          Сбросить всё
        </button>
      </li>
    </ul>
  );
}
