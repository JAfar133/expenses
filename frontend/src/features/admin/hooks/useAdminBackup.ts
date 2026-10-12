import { useQuery } from '@tanstack/react-query';
import { fetchAdminBackup } from '../api/admin.api.ts';

export const ADMIN_BACKUP_KEY = ['admin', 'backup'];

/**
 * State of the database backup. `enabled: false` (not an application admin) means the endpoint is never requested.
 * No polling: the header dot refreshes at most every five minutes, the admin page has a refresh button.
 */
export function useAdminBackup(enabled = true) {
  return useQuery({
    queryKey: ADMIN_BACKUP_KEY,
    queryFn: fetchAdminBackup,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** A problem worth a red mark: no fresh copy or the last run failed. */
export const hasBackupProblem = (state: string | undefined) =>
  state === 'stale' || state === 'failed';
