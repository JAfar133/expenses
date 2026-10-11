import { useQuery } from '@tanstack/react-query';
import { fetchCategories } from '../../expenses/api/expenses.api.ts';
import { fetchRates } from '../../expenses/api/expenses.api.ts';
import { useAuthors, useBreakdown } from './useAnalytics.ts';

export interface Option {
  value: string;
  label: string;
}

const asOptions = (values: string[]): Option[] => values.map((value) => ({ value, label: value }));

/** Варианты для фильтров: карты, категории, авторы и валюты. Пока не загрузились, списки пустые. */
export function useFilterOptions() {
  const cards = useBreakdown({}, 'card');
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 60_000,
  });
  const authors = useAuthors();
  const rates = useQuery({
    queryKey: ['rates'],
    queryFn: fetchRates,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    cards: asOptions(cards.data?.map((row) => row.key) ?? []),
    categories: asOptions(categories.data ?? []),
    authors: (authors.data ?? []).map(({ value, label }) => ({ value, label })),
    currencies: asOptions(rates.data?.currencies ?? []),
  };
}
