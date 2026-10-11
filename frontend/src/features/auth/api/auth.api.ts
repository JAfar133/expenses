import { ApiError, apiRequest } from '../../../shared/api/http.ts';

export interface AuthUser {
  username: string;
  displayName: string;
  /** Карта по умолчанию для формы расхода */
  card: string;
  /** Может ли пользователь править и удалять записи */
  canEdit: boolean;
  /** Часовой пояс пользователя (IANA): по нему определяется «сегодня» */
  timezone: string;
}

/** Текущий пользователь или null, если не выполнен вход. Остальные ошибки (сеть, сервер) пробрасываются. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return (await apiRequest<{ user: AuthUser }>('/auth/me')).data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await apiRequest<{ user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return response.data.user;
}

export async function logout(): Promise<void> {
  await apiRequest('/auth/logout', { method: 'POST' });
}

/** Личные настройки аккаунта; `null` возвращает значение по умолчанию, не указанное поле не меняется. */
export interface ProfilePatch {
  displayName?: string | null;
  card?: string | null;
  timezone?: string | null;
}

export async function updateProfile(patch: ProfilePatch): Promise<AuthUser> {
  const response = await apiRequest<{ user: AuthUser }>('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.data.user;
}
