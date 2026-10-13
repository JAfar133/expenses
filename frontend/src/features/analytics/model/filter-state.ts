import type { AnalyticsFilters, Granularity } from '../api/analytics.api.ts';
import { addDays, daysBetween, isMonthKey, monthOf, monthRange, type MonthKey } from './periods.ts';

export const PERIODS = ['month', '30d', '90d', 'year', 'all', 'custom'] as const;
export type PeriodKind = (typeof PERIODS)[number];

/** Analytics page filter state. Stored in the URL, so the link can be shared. */
export interface FilterState {
  period: PeriodKind;
  /** Month for the "month" period */
  month: MonthKey;
  /** Bounds for the "custom" period; YYYY-MM-DD */
  from?: string;
  to?: string;
  cards: string[];
  categories: string[];
  createdBy: string[];
  currencies: string[];
  /** «All except»: a value is never in both a list and its exclude list */
  excludeCards: string[];
  excludeCategories: string[];
  excludeCreatedBy: string[];
  excludeCurrencies: string[];
  q: string;
  minAmount?: number;
  maxAmount?: number;
  includeDeleted: boolean;
  /** Show expenses of archived cards and categories too (off by default) */
  includeArchived: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date: February 31 will not pass, even if the JavaScript engine can "roll over" days. */
const isIsoDate = (value: string | null): value is string => {
  if (value === null || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const amountParam = (value: string | null): number | undefined => {
  if (value === null || !/^\d{1,10}$/.test(value)) return undefined;
  const amount = Number(value);
  return amount <= 2_147_483_647 ? amount : undefined;
};

/** Parses the URL; anything invalid is replaced with the default. */
export function parseFilterState(params: URLSearchParams, today: string): FilterState {
  const latest = monthOf(today);
  const requestedMonth = params.get('month');
  const month = isMonthKey(requestedMonth) && requestedMonth <= latest ? requestedMonth : latest;

  const requestedPeriod = params.get('period');
  let period: PeriodKind = (PERIODS as readonly string[]).includes(requestedPeriod ?? '')
    ? (requestedPeriod as PeriodKind)
    : 'month';

  let from = params.get('from');
  let to = params.get('to');
  const fromOk = isIsoDate(from) ? from : undefined;
  const toOk = isIsoDate(to) ? to : undefined;
  // A custom period without bounds or with swapped bounds makes no sense: fall back to month
  if (period === 'custom' && ((!fromOk && !toOk) || (fromOk && toOk && fromOk > toOk))) {
    period = 'month';
  }
  from = fromOk ?? null;
  to = toOk ?? null;

  const minAmount = amountParam(params.get('min'));
  const maxAmount = amountParam(params.get('max'));

  return {
    period,
    month,
    from: period === 'custom' ? (from ?? undefined) : undefined,
    to: period === 'custom' ? (to ?? undefined) : undefined,
    cards: unique(params.getAll('card')),
    categories: unique(params.getAll('category')),
    createdBy: unique(params.getAll('by')),
    currencies: unique(params.getAll('cur')),
    excludeCards: unique(params.getAll('exclude_cards')),
    excludeCategories: unique(params.getAll('exclude_categories')),
    excludeCreatedBy: unique(params.getAll('exclude_by')),
    excludeCurrencies: unique(params.getAll('exclude_cur')),
    q: (params.get('q') ?? '').slice(0, 100),
    minAmount,
    maxAmount:
      minAmount !== undefined && maxAmount !== undefined && maxAmount < minAmount
        ? undefined
        : maxAmount,
    includeDeleted: params.get('deleted') === '1',
    includeArchived: params.get('archive') === '1',
  };
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** State to the URL: default values are not written. */
export function serializeFilterState(state: FilterState, today: string): URLSearchParams {
  const params = new URLSearchParams();
  const latest = monthOf(today);

  if (state.period !== 'month') params.set('period', state.period);
  if (state.period === 'month' && state.month !== latest) params.set('month', state.month);
  if (state.period === 'custom') {
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
  }
  state.cards.forEach((value) => params.append('card', value));
  state.categories.forEach((value) => params.append('category', value));
  state.createdBy.forEach((value) => params.append('by', value));
  state.currencies.forEach((value) => params.append('cur', value));
  state.excludeCards.forEach((value) => params.append('exclude_cards', value));
  state.excludeCategories.forEach((value) => params.append('exclude_categories', value));
  state.excludeCreatedBy.forEach((value) => params.append('exclude_by', value));
  state.excludeCurrencies.forEach((value) => params.append('exclude_cur', value));
  if (state.q) params.set('q', state.q);
  if (state.minAmount !== undefined) params.set('min', String(state.minAmount));
  if (state.maxAmount !== undefined) params.set('max', String(state.maxAmount));
  if (state.includeDeleted) params.set('deleted', '1');
  if (state.includeArchived) params.set('archive', '1');
  return params;
}

/** Period bounds; there are none for "all time". */
export function periodRange(state: FilterState, today: string): { from?: string; to?: string } {
  switch (state.period) {
    case 'month':
      return monthRange(state.month);
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom':
      return { from: state.from, to: state.to };
    case 'all':
      return {};
  }
}

/** Filters for server requests (without the period if `withPeriod` is off). */
export function toApiFilters(
  state: FilterState,
  today: string,
  withPeriod = true,
): AnalyticsFilters {
  return {
    ...(withPeriod ? periodRange(state, today) : {}),
    cards: state.cards,
    categories: state.categories,
    createdBy: state.createdBy,
    currencies: state.currencies,
    excludeCards: state.excludeCards,
    excludeCategories: state.excludeCategories,
    excludeCreatedBy: state.excludeCreatedBy,
    excludeCurrencies: state.excludeCurrencies,
    q: state.q || undefined,
    minAmount: state.minAmount,
    maxAmount: state.maxAmount,
    includeDeleted: state.includeDeleted,
    includeArchived: state.includeArchived,
  };
}

/**
 * Chart time step: up to two months by day, up to a year by week, beyond that by month.
 * This keeps a readable number of bars on the chart.
 */
export function granularityFor(state: FilterState, today: string): Granularity {
  const { from, to } = periodRange(state, today);
  if (!from) return 'month';
  const end = to && to < today ? to : today;
  const days = daysBetween(from, end);
  if (days <= 62) return 'day';
  return days <= 400 ? 'week' : 'month';
}

/** How many filters are enabled (the period does not count). */
export function activeFilterCount(state: FilterState): number {
  return (
    (state.cards.length ? 1 : 0) +
    (state.categories.length ? 1 : 0) +
    (state.createdBy.length ? 1 : 0) +
    (state.currencies.length ? 1 : 0) +
    (state.excludeCards.length ? 1 : 0) +
    (state.excludeCategories.length ? 1 : 0) +
    (state.excludeCreatedBy.length ? 1 : 0) +
    (state.excludeCurrencies.length ? 1 : 0) +
    (state.q ? 1 : 0) +
    (state.minAmount !== undefined || state.maxAmount !== undefined ? 1 : 0) +
    (state.includeDeleted ? 1 : 0) +
    (state.includeArchived ? 1 : 0)
  );
}

/** State without filters but with the same period. */
export const withoutFilters = (state: FilterState): FilterState => ({
  ...state,
  cards: [],
  categories: [],
  createdBy: [],
  currencies: [],
  excludeCards: [],
  excludeCategories: [],
  excludeCreatedBy: [],
  excludeCurrencies: [],
  q: '',
  minAmount: undefined,
  maxAmount: undefined,
  includeDeleted: false,
  includeArchived: false,
});

/** URL parameters controlled by filters; others (tabs, month comparison) are left alone. */
const FILTER_KEYS = [
  'period',
  'month',
  'from',
  'to',
  'card',
  'category',
  'by',
  'cur',
  'exclude_cards',
  'exclude_categories',
  'exclude_by',
  'exclude_cur',
  'q',
  'min',
  'max',
  'deleted',
  'archive',
];

/** Writes the state to the URL, preserving foreign parameters. */
export function mergeFilterParams(
  current: URLSearchParams,
  state: FilterState,
  today: string,
): URLSearchParams {
  const merged = new URLSearchParams(current);
  FILTER_KEYS.forEach((key) => merged.delete(key));
  serializeFilterState(state, today).forEach((value, key) => merged.append(key, value));
  return merged;
}

/**
 * Whether a category passes the shared filters, for views that are not filtered by the server (the limits list):
 * not excluded; chosen if some are chosen; an archived one only with «Показывать архив» or when chosen explicitly.
 */
export function categoryPasses(
  state: FilterState,
  archived: ReadonlySet<string>,
  name: string,
): boolean {
  if (state.excludeCategories.includes(name)) return false;
  const chosen = state.categories.includes(name);
  if (state.categories.length > 0 && !chosen) return false;
  return !archived.has(name) || state.includeArchived || chosen;
}
