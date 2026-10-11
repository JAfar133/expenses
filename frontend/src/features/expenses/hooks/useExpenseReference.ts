import { useQueries } from '@tanstack/react-query';
import { fetchCards, fetchCategories, fetchCurrency } from '../api/expenses.api.ts';

/** Reference data for the form: cards, categories and currency. */
export function useExpenseReference() {
  const [cards, categories, currency] = useQueries({
    queries: [
      { queryKey: ['cards'], queryFn: fetchCards, staleTime: Infinity },
      { queryKey: ['categories'], queryFn: fetchCategories, staleTime: 60_000 },
      { queryKey: ['currency'], queryFn: fetchCurrency, staleTime: Infinity },
    ],
  });

  const queries = [cards, categories, currency];
  return {
    isLoading: queries.some((query) => query.isPending),
    isError: queries.some((query) => query.isError),
    refetch: () => queries.forEach((query) => void query.refetch()),
    data:
      cards.data && categories.data && currency.data
        ? { cards: cards.data, categories: categories.data, currency: currency.data }
        : undefined,
  };
}
