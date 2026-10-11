import { useQuery } from '@tanstack/react-query';
import { fetchNameSuggestions } from '../api/expenses.api.ts';

export const NAME_SUGGESTIONS_KEY = ['name-suggestions'];

/** Suggestions are optional: on error or while loading, the form works without them. */
export function useNameSuggestions() {
  return useQuery({
    queryKey: NAME_SUGGESTIONS_KEY,
    queryFn: fetchNameSuggestions,
    staleTime: 60_000,
    retry: false,
  });
}
