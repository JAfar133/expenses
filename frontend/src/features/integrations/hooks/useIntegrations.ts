import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createApiKey,
  fetchApiKeys,
  fetchImportLog,
  revokeApiKey,
  updateApiKey,
} from '../api/integrations.api.ts';

const KEYS = ['group', 'api-keys'];

export const useApiKeys = () => useQuery({ queryKey: KEYS, queryFn: fetchApiKeys, retry: false });

/** The log of requests; the source is part of the key, so each filter has its own list. */
export const useImportLog = (source?: string) =>
  useQuery({
    queryKey: ['group', 'import-log', source ?? 'all'],
    queryFn: () => fetchImportLog(source),
    retry: false,
  });

/**
 * Creating a key. The answer (with the full key) is NOT kept in the query cache: it goes to the caller only, and the
 * mutation result is dropped with `reset()` when the dialog closes.
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: createApiKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: revokeApiKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; defaultCategory?: string | null };
    }) => updateApiKey(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS }),
  });
}
