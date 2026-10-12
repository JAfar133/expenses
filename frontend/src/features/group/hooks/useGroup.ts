import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BUDGETS_KEY } from '../../budgets/hooks/useBudgets.ts';
import { fetchGroup } from '../api/group.api.ts';

export const GROUP_KEY = ['group'];

/** The group of the owner: members, cards, categories and pending invitations. */
export function useGroup() {
  return useQuery({ queryKey: GROUP_KEY, queryFn: fetchGroup, retry: false });
}

/** A simple mutation that refreshes the group data afterwards. */
export function useGroupMutation<TInput, TResult = unknown>(
  action: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: action,
    onSuccess: () => {
      // Categories and cards affect what limits count
      void queryClient.invalidateQueries({ queryKey: BUDGETS_KEY });
      return queryClient.invalidateQueries({ queryKey: GROUP_KEY });
    },
  });
}
