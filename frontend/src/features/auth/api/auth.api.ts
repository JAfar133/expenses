import { ApiError, apiRequest } from '../../../shared/api/http.ts';

export interface AuthUser {
  username: string;
  displayName: string;
  /** Default card for the expense form */
  card: string;
  /** Whether the user can edit and delete records */
  canEdit: boolean;
  /** User time zone (IANA): "today" is determined by it */
  timezone: string;
  /** The time zone from the server configuration: what "default" means in the account settings */
  defaultTimezone?: string;
  /** Role in the group; null for an account without a group */
  role: 'owner' | 'member' | null;
  /** Application administrator */
  isAdmin: boolean;
}

/** Current user, or null if not signed in. Other errors (network, server) are rethrown. */
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

/** Personal account settings; `null` resets to the default, an omitted field is unchanged. */
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
