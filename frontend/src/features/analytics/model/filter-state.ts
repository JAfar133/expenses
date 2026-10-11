import type { AnalyticsFilters, Granularity } from '../api/analytics.api.ts';
import { addDays, daysBetween, isMonthKey, monthOf, monthRange, type MonthKey } from './periods.ts';

export const PERIODS = ['month', '30d', '90d', 'year', 'all', 'custom'] as const;
export type PeriodKind = (typeof PERIODS)[number];

/** Состояние фильтров страницы анализа. Хранится в адресной строке, поэтому ссылкой можно поделиться. */
export interface FilterState {
  period: PeriodKind;
  /** Месяц для периода «месяц» */
  month: MonthKey;
  /** Границы для периода «свой»; YYYY-MM-DD */
  from?: string;
  to?: string;
  cards: string[];
  categories: string[];
  createdBy: string[];
  currencies: string[];
  q: string;
  minAmount?: number;
  maxAmount?: number;
  includeDeleted: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Настоящая дата календаря: 31 февраля не пройдёт, даже если движок JavaScript умеет «переносить» дни. */
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

/** Разбирает адресную строку; всё некорректное заменяется значением по умолчанию. */
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
  // Свой период без границ или с перепутанными границами не имеет смысла: возвращаемся к месяцу
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
    q: (params.get('q') ?? '').slice(0, 100),
    minAmount,
    maxAmount:
      minAmount !== undefined && maxAmount !== undefined && maxAmount < minAmount
        ? undefined
        : maxAmount,
    includeDeleted: params.get('deleted') === '1',
  };
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** Состояние в адресную строку: значения по умолчанию не пишутся. */
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
  if (state.q) params.set('q', state.q);
  if (state.minAmount !== undefined) params.set('min', String(state.minAmount));
  if (state.maxAmount !== undefined) params.set('max', String(state.maxAmount));
  if (state.includeDeleted) params.set('deleted', '1');
  return params;
}

/** Границы периода; для «всё время» их нет. */
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

/** Фильтры для запросов к серверу (без периода, если `withPeriod` выключен). */
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
    q: state.q || undefined,
    minAmount: state.minAmount,
    maxAmount: state.maxAmount,
    includeDeleted: state.includeDeleted,
  };
}

/**
 * Шаг графика по времени: до двух месяцев по дням, до года по неделям, дальше по месяцам.
 * Так на графике остаётся читаемое число столбиков.
 */
export function granularityFor(state: FilterState, today: string): Granularity {
  const { from, to } = periodRange(state, today);
  if (!from) return 'month';
  const end = to && to < today ? to : today;
  const days = daysBetween(from, end);
  if (days <= 62) return 'day';
  return days <= 400 ? 'week' : 'month';
}

/** Сколько фильтров включено (период не считается). */
export function activeFilterCount(state: FilterState): number {
  return (
    (state.cards.length ? 1 : 0) +
    (state.categories.length ? 1 : 0) +
    (state.createdBy.length ? 1 : 0) +
    (state.currencies.length ? 1 : 0) +
    (state.q ? 1 : 0) +
    (state.minAmount !== undefined || state.maxAmount !== undefined ? 1 : 0) +
    (state.includeDeleted ? 1 : 0)
  );
}

/** Состояние без фильтров, но с тем же периодом. */
export const withoutFilters = (state: FilterState): FilterState => ({
  ...state,
  cards: [],
  categories: [],
  createdBy: [],
  currencies: [],
  q: '',
  minAmount: undefined,
  maxAmount: undefined,
  includeDeleted: false,
});

/** Параметры адреса, которыми управляют фильтры; остальные (вкладки, сравнение месяцев) не трогаем. */
const FILTER_KEYS = [
  'period',
  'month',
  'from',
  'to',
  'card',
  'category',
  'by',
  'cur',
  'q',
  'min',
  'max',
  'deleted',
];

/** Записывает состояние в адрес, сохраняя посторонние параметры. */
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
