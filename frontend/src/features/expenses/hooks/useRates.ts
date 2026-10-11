import { useQuery } from '@tanstack/react-query';
import { fetchRates } from '../api/expenses.api.ts';

/** Курсы нужны только для иностранной валюты: при ошибке форма работает в базовой валюте. */
export function useRates() {
  return useQuery({
    queryKey: ['rates'],
    queryFn: fetchRates,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
