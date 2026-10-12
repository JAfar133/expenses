import { useQuery } from '@tanstack/react-query';
import { fetchCategories } from '../../expenses/api/expenses.api.ts';
import { fetchRates } from '../../expenses/api/expenses.api.ts';
import { useAuthors, useFilterCards } from './useAnalytics.ts';

export interface Option {
  value: string;
  label: string;
}

const asOptions = (values: string[]): Option[] => values.map((value) => ({ value, label: value }));

/** Filter options: cards, categories, authors and currencies. Lists are empty until loaded. */
export function useFilterOptions() {
  const cards = useFilterCards();
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
    // Every card of the group the user can see; an archived one is marked: its old expenses can still be filtered
    cards: (cards.data ?? []).map(({ name, archived }) => ({
      value: name,
      label: archived ? `${name} (архив)` : name,
    })),
    categories: asOptions(categories.data ?? []),
    authors: (authors.data ?? []).map(({ value, label }) => ({ value, label })),
    currencies: asOptions(rates.data?.currencies ?? []),
  };
}
