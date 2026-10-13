import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_STATUS_KEY } from '../../ai/hooks/useAiStatus.ts';
import { fetchAdminAi } from '../api/admin.api.ts';

export const ADMIN_AI_KEY = ['admin', 'ai'];

export const useAdminAi = () =>
  useQuery({ queryKey: ADMIN_AI_KEY, queryFn: fetchAdminAi, retry: false });

/** After any change the admin block and the AI status of the app are stale. */
export function useRefreshAdminAi() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: AI_STATUS_KEY });
    return queryClient.invalidateQueries({ queryKey: ADMIN_AI_KEY });
  };
}
