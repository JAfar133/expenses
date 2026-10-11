import type { NameSuggestion } from '../api/expenses.api.ts';

/** How many suggestions to show: the rest are not popular enough to matter. */
export const MAX_SUGGESTIONS = 30;

interface PickOptions {
  /** Selected category; empty: no suggestions */
  category: string;
  /** Name text already entered */
  query: string;
  limit?: number;
}

const normalize = (text: string) => text.trim().toLowerCase();

/**
 * Suggestions for the name field from the selected category, from most to least popular.
 * The source list is already sorted by the server, order is preserved. No category selected: no suggestions.
 */
export function pickSuggestions(
  all: NameSuggestion[],
  { category, query, limit = MAX_SUGGESTIONS }: PickOptions,
): NameSuggestion[] {
  if (!category) return [];

  const typed = normalize(query);
  return all
    .filter((item) => {
      if (item.category !== category) return false;
      const name = normalize(item.name);
      // Exact match already entered: no point suggesting it
      return name.includes(typed) && name !== typed;
    })
    .slice(0, limit);
}
