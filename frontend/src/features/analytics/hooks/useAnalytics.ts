import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
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

export const useBreakdown = (filters: AnalyticsFilters, by: BreakdownBy) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'breakdown', by, filters],
    queryFn: () => fetchBreakdown(filters, by),
    ...options,
  });

export const useTimeseries = (filters: AnalyticsFilters, granularity: Granularity) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'timeseries', granularity, filters],
    queryFn: () => fetchTimeseries(filters, granularity),
    ...options,
  });
