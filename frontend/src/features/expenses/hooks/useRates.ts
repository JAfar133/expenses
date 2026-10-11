import { useQuery } from '@tanstack/react-query';
import { fetchRates } from '../api/expenses.api.ts';

/** Rates are needed only for a foreign currency: on error the form works in the base currency. */
export function useRates() {
  return useQuery({
    queryKey: ['rates'],
    queryFn: fetchRates,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
