import { useQuery } from '@tanstack/react-query';
import { fetchRates } from '../../expenses/api/expenses.api.ts';
import { useAuthors, useFilterCards, useFilterCategories } from './useAnalytics.ts';

export interface Option {
  value: string;
  label: string;
}

const asOption = (name: string, archived: boolean): Option => ({
  value: name,
  label: archived ? `${name} (архив)` : name,
});

/** Filter options: cards, categories, authors and currencies. Lists are empty until loaded. */
export function useFilterOptions() {
  const cards = useFilterCards();
  const categories = useFilterCategories();
  const authors = useAuthors();
  const rates = useQuery({
    queryKey: ['rates'],
    queryFn: fetchRates,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const cardList = cards.data ?? [];
  const categoryList = categories.data ?? [];

  return {
    // Every card and category of the group; an archived one is marked: its old expenses can still be filtered
    cards: cardList.map(({ name, archived }) => asOption(name, archived)),
    categories: categoryList.map(({ name, archived }) => asOption(name, archived)),
    /** Only the live categories: what a record can be moved to */
    activeCategories: categoryList.filter(({ archived }) => !archived).map(({ name }) => name),
    /** Whether the group has anything archived: only then the «Показывать архив» switch is shown */
    hasArchive: [...cardList, ...categoryList].some(({ archived }) => archived),
    authors: (authors.data ?? []).map(({ value, label }) => ({ value, label })),
    currencies: (rates.data?.currencies ?? []).map((value) => asOption(value, false)),
  };
}
