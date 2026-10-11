import { useQuery } from '@tanstack/react-query';
import { fetchCategories, fetchCurrency } from '../../expenses/api/expenses.api.ts';

/** Reference data for the analytics page: base currency and category order (colors are pinned by it). */
export function useAnalyticsReference() {
  const currency = useQuery({
    queryKey: ['currency'],
    queryFn: fetchCurrency,
    staleTime: Infinity,
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 60_000,
  });

  return {
    currency: currency.data ?? 'AMD',
    categoryOrder: categories.data ?? [],
  };
}
