import { apiRequest } from '../../../shared/api/http.ts';
import type { MemberRole } from './group.api.ts';

export interface InvitationPreview {
  kind: 'join' | 'reset';
  groupName: string | null;
  role: MemberRole | null;
  username: string | null;
}

export interface AcceptInvitationInput {
  username?: string;
  displayName?: string;
  password: string;
}

const path = (token: string) => `/invitations/${encodeURIComponent(token)}`;

/** Public: works without signing in. */
export const fetchInvitation = async (token: string) =>
  (await apiRequest<InvitationPreview>(path(token))).data;

/** Public: the server signs the person in (cookies) on success. */
export const acceptInvitation = async (token: string, input: AcceptInvitationInput) =>
  (
    await apiRequest<{ username: string }>(`${path(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).data;
