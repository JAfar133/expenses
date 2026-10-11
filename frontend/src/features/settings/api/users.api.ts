import { apiRequest } from '../../../shared/api/http.ts';

export interface UserRights {
  username: string;
  displayName: string;
  canEdit: boolean;
}

/** Users and their permissions; the server returns the list only to editors. */
export const listUsers = async () => (await apiRequest<UserRights[]>('/users')).data;

export const setUserRights = async (username: string, canEdit: boolean) =>
  (
    await apiRequest<{ username: string; canEdit: boolean }>(
      `/users/${encodeURIComponent(username)}/rights`,
      { method: 'PUT', body: JSON.stringify({ canEdit }) },
    )
  ).data;
