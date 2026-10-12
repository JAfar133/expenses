import { apiRequest } from '../../../shared/api/http.ts';
import type { IssuedLink } from '../../group/api/group.api.ts';

export interface AdminGroup {
  id: number;
  name: string;
  reportingCurrency: string;
  disabled: boolean;
  owners: number;
  members: number;
  createdAt: string;
}

export const fetchAdminGroups = async () => (await apiRequest<AdminGroup[]>('/admin/groups')).data;

export const createGroup = async (input: { name: string; currency?: string }) =>
  (
    await apiRequest<IssuedLink & { id: number }>('/admin/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).data;

export const setGroupDisabled = (id: number, disabled: boolean) =>
  apiRequest(`/admin/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ disabled }) });

export const createOwnerInvitation = async (groupId: number) =>
  (await apiRequest<IssuedLink>(`/admin/groups/${groupId}/owner-invitations`, { method: 'POST' }))
    .data;

export const createUserResetLink = async (username: string) =>
  (
    await apiRequest<IssuedLink>(`/admin/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'POST',
    })
  ).data;
