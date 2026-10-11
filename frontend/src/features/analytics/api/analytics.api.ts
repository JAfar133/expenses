import { apiRequest } from '../../../shared/api/http.ts';

/** Общие фильтры страницы анализа. Пустое значение означает «без ограничения». */
export interface AnalyticsFilters {
  /** Границы периода включительно, YYYY-MM-DD */
  from?: string;
  to?: string;
  cards?: string[];
  categories?: string[];
  createdBy?: string[];
  currencies?: string[];
  q?: string;
  minAmount?: number;
  maxAmount?: number;
  includeDeleted?: boolean;
}

export interface SummaryStats {
  total: number;
  count: number;
  average: number;
  median: number;
  max: number;
  activeDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface PeriodSummary extends SummaryStats {
  /** Сколько дней периода прошло (до сегодня) */
  days: number;
  /** Средний расход в день за прошедшие дни */
  perDay: number;
}

export interface SummaryResult {
  current: PeriodSummary;
  /** Предыдущий период такой же длины; null, если период не задан */
  previous: PeriodSummary | null;
}

export type BreakdownBy = 'category' | 'card' | 'name' | 'weekday' | 'currency' | 'createdBy';

export interface BreakdownRow {
  key: string;
  total: number;
  count: number;
  average: number;
}

export type Granularity = 'day' | 'week' | 'month';

export interface SeriesPoint {
  /** Первый день периода, YYYY-MM-DD */
  period: string;
  key?: string;
  total: number;
  count: number;
}

type Param = string | number | boolean | string[] | undefined;

/** Фильтры и дополнительные параметры в адресную строку. Списки передаются повторами: `cards=a&cards=b`. */
export function toSearch(filters: AnalyticsFilters, extra: Record<string, Param> = {}): string {
  const params = new URLSearchParams();
  const entries: [string, Param][] = [...Object.entries(filters), ...Object.entries(extra)];

  for (const [name, value] of entries) {
    if (value === undefined || value === '' || value === false) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(name, item));
    else params.set(name, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const fetchSummary = async (filters: AnalyticsFilters) =>
  (await apiRequest<SummaryResult>(`/analytics/summary${toSearch(filters)}`)).data;

export const fetchBreakdown = async (filters: AnalyticsFilters, by: BreakdownBy) =>
  (await apiRequest<BreakdownRow[]>(`/analytics/breakdown${toSearch(filters, { by })}`)).data;

export const fetchTimeseries = async (
  filters: AnalyticsFilters,
  granularity: Granularity,
  splitBy?: 'category' | 'card',
) =>
  (
    await apiRequest<SeriesPoint[]>(
      `/analytics/timeseries${toSearch(filters, { granularity, splitBy })}`,
    )
  ).data;

/** Кто добавлял расходы: логин для фильтра, имя для показа. */
export interface Author {
  value: string;
  label: string;
  count: number;
}

export const fetchAuthors = async () => (await apiRequest<Author[]>('/analytics/authors')).data;
