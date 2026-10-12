import { useQuery } from '@tanstack/react-query';
import { fetchCategories } from '../../expenses/api/expenses.api.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';

/** Reference data for the analytics page: reporting and base currencies, category order (colors are pinned by it). */
export function useAnalyticsReference() {
  const config = useConfig();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 60_000,
  });

  return {
    /** Reporting currency of the group: all analytics amounts are in it */
    currency: config.data?.currency ?? 'AMD',
    /** Drams: rates are quoted against it */
    baseCurrency: config.data?.baseCurrency ?? 'AMD',
    categoryOrder: categories.data ?? [],
  };
}
