import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchCurrentUser, login, logout, type AuthUser } from '../api/auth.api.ts';

export const CURRENT_USER_KEY = ['auth', 'current-user'];

/**
 * Забывает данные предыдущего пользователя (справочники, состояние синхронизации) и запоминает нового.
 * Сам запрос текущего пользователя не удаляем: на него подписан экран, и он мог бы зависнуть.
 */
export function resetCacheFor(queryClient: QueryClient, user: AuthUser | null) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
  queryClient.setQueryData(CURRENT_USER_KEY, user);
}

/** Текущий пользователь: AuthUser, null (не вошли) или ошибка (нет связи с сервером). */
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
    onSuccess: () => resetCacheFor(queryClient, null),
  });
}
