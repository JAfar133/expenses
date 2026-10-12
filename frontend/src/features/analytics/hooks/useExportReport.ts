import { useMutation } from '@tanstack/react-query';
import { downloadExport } from '../api/operations.api.ts';
import type { AnalyticsFilters } from '../api/analytics.api.ts';

/** Downloads the .xlsx report for exactly the given filters (the same ones the page shows). */
export function useExportReport(filters: AnalyticsFilters) {
  return useMutation({ retry: false, mutationFn: () => downloadExport(filters) });
}
