import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchAuthors,
  fetchBreakdown,
  fetchSummary,
  fetchTimeseries,
  type AnalyticsFilters,
  type BreakdownBy,
  type Granularity,
} from '../api/analytics.api.ts';

/** Общий префикс ключей: по нему данные сбрасываются после добавления расхода и синхронизации. */
export const ANALYTICS_KEY = ['analytics'];

const options = {
  staleTime: 30_000,
  // При смене фильтра прежние данные остаются на экране, пока приходят новые
  placeholderData: keepPreviousData,
};

export const useSummary = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'summary', filters],
    queryFn: () => fetchSummary(filters),
    ...options,
  });

export const useBreakdown = (
  filters: AnalyticsFilters,
  by: BreakdownBy,
  { enabled = true }: { enabled?: boolean } = {},
) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'breakdown', by, filters],
    queryFn: () => fetchBreakdown(filters, by),
    enabled,
    ...options,
  });

export const useTimeseries = (
  filters: AnalyticsFilters,
  granularity: Granularity,
  splitBy?: 'category' | 'card',
) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'timeseries', granularity, splitBy ?? null, filters],
    queryFn: () => fetchTimeseries(filters, granularity, splitBy),
    ...options,
  });

/** Список авторов для фильтра; меняется редко. */
export const useAuthors = () =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'authors'],
    queryFn: fetchAuthors,
    staleTime: 5 * 60_000,
  });
