import { useQuery } from '@tanstack/react-query';
import { fetchCategories, fetchCurrency } from '../../expenses/api/expenses.api.ts';

/** Справочники для страницы анализа: базовая валюта и порядок категорий (по нему закрепляются цвета). */
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
