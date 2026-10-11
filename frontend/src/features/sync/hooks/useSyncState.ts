import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { fetchSyncState, runSync } from '../api/sync.api.ts';

export const SYNC_STATE_KEY = ['sync-state'];

const POLL_MS = 5000;
const POLL_WHILE_RUNNING_MS = 2000;

export function useSyncState() {
  return useQuery({
    queryKey: SYNC_STATE_KEY,
    queryFn: fetchSyncState,
    refetchInterval: (query) => (query.state.data?.running ? POLL_WHILE_RUNNING_MS : POLL_MS),
  });
}

export function useRunSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runSync,
    onSuccess: (state) => {
      queryClient.setQueryData(SYNC_STATE_KEY, state);
      // Синхронизация могла принести новые категории из Excel
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      // Из Excel могли прийти новые расходы
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });
    },
  });
}
