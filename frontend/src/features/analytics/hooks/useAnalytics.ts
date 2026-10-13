import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchAuthors,
  fetchFilterCards,
  fetchFilterCategories,
  fetchBreakdown,
  fetchSummary,
  fetchTimeseries,
  type AnalyticsFilters,
  type BreakdownBy,
  type Granularity,
} from '../api/analytics.api.ts';

/** Common key prefix: data is invalidated by it after adding an expense and after sync. */
export const ANALYTICS_KEY = ['analytics'];

const options = {
  staleTime: 30_000,
  // When the filter changes, previous data stays on screen while new data arrives
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
  { enabled = true }: { enabled?: boolean } = {},
) =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'timeseries', granularity, splitBy ?? null, filters],
    queryFn: () => fetchTimeseries(filters, granularity, splitBy),
    enabled,
    ...options,
  });

/** List of authors for the filter; changes rarely. */
/** All cards the user can see: new and empty ones are in the filter too. */
export const useFilterCards = () =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'cards'],
    queryFn: fetchFilterCards,
    staleTime: 60_000,
  });

/** All categories of the group for the filter (archived ones are marked). */
export const useFilterCategories = () =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'categories'],
    queryFn: fetchFilterCategories,
    staleTime: 60_000,
  });

export const useAuthors = () =>
  useQuery({
    queryKey: [...ANALYTICS_KEY, 'authors'],
    queryFn: fetchAuthors,
    staleTime: 5 * 60_000,
  });
