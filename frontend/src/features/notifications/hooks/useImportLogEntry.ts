import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchImportLogEntry,
  retryImportLogEntry,
} from '../../integrations/api/integrations.api.ts';
import { NOTIFICATIONS_KEY } from './useNotifications.ts';

/** One request of the import log, for the details of an import problem. A 404 or 403 is not retried. */
export const useImportLogEntry = (id: string | null) =>
  useQuery({
    queryKey: ['group', 'import-log', 'entry', id],
    queryFn: () => fetchImportLogEntry(id!),
    enabled: id !== null,
    retry: false,
    staleTime: 0,
  });

/** Processes the request again; afterwards the feed and the log are read anew (the old notification is retracted). */
export function useRetryImport() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) => retryImportLogEntry(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['group', 'import-log'] });
    },
  });
}
