import { useQuery } from '@tanstack/react-query';
import { fetchConfig } from '../api/expenses.api.ts';

export const CONFIG_KEY = ['config'];

/** Reporting currency of the group and the base (drams) currency of rates. */
export function useConfig() {
  return useQuery({ queryKey: CONFIG_KEY, queryFn: fetchConfig, staleTime: Infinity });
}
