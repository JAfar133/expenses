import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { clearAllDrafts } from '../../offline-queue/model/draft-store.ts';
import { fetchCurrentUser, login, logout, type AuthUser } from '../api/auth.api.ts';

export const CURRENT_USER_KEY = ['auth', 'current-user'];

/**
 * Forgets the previous user's data (reference data, sync state) and remembers the new one.
 * The current-user query itself is not removed: the screen subscribes to it and it could hang.
 */
export function resetCacheFor(queryClient: QueryClient, user: AuthUser | null) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
  queryClient.setQueryData(CURRENT_USER_KEY, user);
}

/** Current user: AuthUser, null (not signed in) or an error (no connection to the server). */
export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      login(username, password),
    onSuccess: (user) => resetCacheFor(queryClient, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      resetCacheFor(queryClient, null);
      // The unsaved form of the signed-out person does not stay on the device
      void clearAllDrafts();
    },
  });
}
