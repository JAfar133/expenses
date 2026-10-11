import { useQuery } from '@tanstack/react-query';
import { fetchNameSuggestions } from '../api/expenses.api.ts';

export const NAME_SUGGESTIONS_KEY = ['name-suggestions'];

/** Подсказки необязательны: при ошибке или пока грузятся, форма работает без них. */
export function useNameSuggestions() {
  return useQuery({
    queryKey: NAME_SUGGESTIONS_KEY,
    queryFn: fetchNameSuggestions,
    staleTime: 60_000,
    retry: false,
  });
}
