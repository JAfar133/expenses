import { apiRequest } from '../../../shared/api/http.ts';

/** Common analytics page filters. An empty value means "no restriction". */
export interface AnalyticsFilters {
  /** Period bounds, inclusive, YYYY-MM-DD */
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
  /** Also count and list expenses of archived cards and categories (the server's default is to leave them out) */
  includeArchived?: boolean;
  /** Display currency: the server sums in it (exact for records kept in it, converted for the rest); default is the reporting currency */
  currency?: string;
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
  /** Days of the period elapsed (up to today) */
  days: number;
  /** Average daily expense over elapsed days */
  perDay: number;
}

export interface SummaryResult {
  current: PeriodSummary;
  /** Previous period of the same length; null if no period is set */
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
  /** First day of the period, YYYY-MM-DD */
  period: string;
  key?: string;
  total: number;
  count: number;
}

type Param = string | number | boolean | string[] | undefined;

/** Filters and extra parameters to the URL. Lists are passed as repeats: `cards=a&cards=b`. */
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

/** Who added expenses: login for the filter, name for display. */
export interface Author {
  value: string;
  label: string;
  count: number;
}

/** A card for the filter: every card the user can see, also an empty or an archived one. */
export interface FilterCard {
  name: string;
  currency: string;
  archived: boolean;
}

export const fetchFilterCards = async () =>
  (await apiRequest<FilterCard[]>('/analytics/cards')).data;

/** A category for the filter: every category of the group, archived ones last. */
export interface FilterCategory {
  name: string;
  archived: boolean;
}

export const fetchFilterCategories = async () =>
  (await apiRequest<FilterCategory[]>('/analytics/categories')).data;

export const fetchAuthors = async () => (await apiRequest<Author[]>('/analytics/authors')).data;
