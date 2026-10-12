import { useQueries } from '@tanstack/react-query';
import { fetchCards, fetchCategories, fetchConfig } from '../api/expenses.api.ts';
import { CONFIG_KEY } from './useConfig.ts';

/** Reference data for the form: cards (with currencies), categories and currencies of the group. */
export function useExpenseReference() {
  const [cards, categories, config] = useQueries({
    queries: [
      { queryKey: ['cards'], queryFn: fetchCards, staleTime: Infinity },
      { queryKey: ['categories'], queryFn: fetchCategories, staleTime: 60_000 },
      { queryKey: CONFIG_KEY, queryFn: fetchConfig, staleTime: Infinity },
    ],
  });

  const queries = [cards, categories, config];
  return {
    isLoading: queries.some((query) => query.isPending),
    isError: queries.some((query) => query.isError),
    refetch: () => queries.forEach((query) => void query.refetch()),
    data:
      cards.data && categories.data && config.data
        ? {
            cards: cards.data,
            categories: categories.data,
            currency: config.data.currency,
            baseCurrency: config.data.baseCurrency,
          }
        : undefined,
  };
}
