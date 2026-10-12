import { apiRequest } from '../../../shared/api/http.ts';

export type MemberRole = 'owner' | 'member';
export type AccessLevel = 'view' | 'edit';

export interface GroupMember {
  userId: number;
  username: string;
  displayName: string;
  role: MemberRole;
  /** The account is managed by server settings: it cannot be removed here */
  fromEnv: boolean;
}

export interface GroupCard {
  id: number;
  name: string;
  currency: string;
  archived: boolean;
  access: { userId: number; level: AccessLevel }[];
}

export interface GroupCategory {
  id: number;
  name: string;
  archived: boolean;
}

export interface GroupInvitation {
  id: number;
  kind: 'join' | 'reset';
  role: MemberRole | null;
  username: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface GroupOverview {
  group: {
    id: number;
    name: string;
    reportingCurrency: string;
    timezone: string;
    disabled: boolean;
  };
  members: GroupMember[];
  cards: GroupCard[];
  categories: GroupCategory[];
  invitations: GroupInvitation[];
}

/** A one-time link token: it is shown only right after creation. */
export interface IssuedLink {
  token: string;
  expiresAt: string;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const member = (username: string) => `/group/members/${encodeURIComponent(username)}`;

export const fetchGroup = async () => (await apiRequest<GroupOverview>('/group')).data;

export const renameGroup = (name: string) =>
  apiRequest('/group', { method: 'PATCH', ...json({ name }) });

export const createCard = (name: string) =>
  apiRequest<{ id: number }>('/group/cards', { method: 'POST', ...json({ name }) });

export const updateCard = (id: number, patch: { name?: string; archived?: boolean }) =>
  apiRequest(`/group/cards/${id}`, { method: 'PATCH', ...json(patch) });

/** Replaces the access of all members: those not listed lose access to the card. */
export const setCardAccess = (id: number, access: Record<string, AccessLevel>) =>
  apiRequest(`/group/cards/${id}/access`, { method: 'PUT', ...json({ access }) });

export const createCategory = (name: string) =>
  apiRequest('/group/categories', { method: 'POST', ...json({ name }) });

export const updateCategory = (id: number, patch: { name?: string; archived?: boolean }) =>
  apiRequest(`/group/categories/${id}`, { method: 'PATCH', ...json(patch) });

export const createInvitation = async (role: MemberRole) =>
  (await apiRequest<IssuedLink>('/group/invitations', { method: 'POST', ...json({ role }) })).data;

export const revokeInvitation = (id: number) =>
  apiRequest(`/group/invitations/${id}`, { method: 'DELETE' });

export const setMemberRole = (username: string, role: MemberRole) =>
  apiRequest(`${member(username)}/role`, { method: 'PUT', ...json({ role }) });

export const createMemberResetLink = async (username: string) =>
  (await apiRequest<IssuedLink>(`${member(username)}/reset-password`, { method: 'POST' })).data;

export const removeMember = (username: string) =>
  apiRequest(member(username), { method: 'DELETE' });
