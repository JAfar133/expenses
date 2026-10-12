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

/** The installation-wide Excel sync switch: `configured` is false when Excel is not set up on the server. */
export interface AdminSync {
  configured: boolean;
  enabled: boolean;
}

export const fetchAdminSync = async () => (await apiRequest<AdminSync>('/admin/sync')).data;

export const setAdminSync = async (enabled: boolean) =>
  (
    await apiRequest<AdminSync>('/admin/sync', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })
  ).data;

/** State of the nightly database backup, as the server sees it (read-only). */
export interface AdminBackup {
  configured: boolean;
  /** ok: a fresh good copy; stale: no good copy for too long; failed: the last run failed; unknown: no data */
  state: 'ok' | 'stale' | 'failed' | 'unknown';
  lastSuccess: {
    at: string;
    file: string;
    sizeBytes: number;
    remote: 'ok' | 'failed' | 'off';
  } | null;
  lastRun: {
    at: string;
    ok: boolean;
    error: '' | 'dump_failed' | 'verify_failed' | 'upload_failed' | 'unexpected';
  } | null;
  ageHours: number | null;
  maxAgeHours: number;
}

export const fetchAdminBackup = async () => (await apiRequest<AdminBackup>('/admin/backup')).data;
