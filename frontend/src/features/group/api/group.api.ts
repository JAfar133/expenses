import { apiRequest } from '../../../shared/api/http.ts';

export type MemberRole = 'owner' | 'member';
export type AccessLevel = 'view' | 'edit';

export interface GroupMember {
  userId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  /** The account is managed by server settings: it cannot be removed here */
  fromEnv: boolean;
}

export interface GroupCard {
  id: string;
  name: string;
  currency: string;
  archived: boolean;
  access: { userId: string; level: AccessLevel }[];
}

export interface GroupCategory {
  id: string;
  name: string;
  archived: boolean;
}

export interface GroupInvitation {
  id: string;
  kind: 'join' | 'reset';
  role: MemberRole | null;
  username: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface GroupOverview {
  group: {
    id: string;
    name: string;
    reportingCurrency: string;
    timezone: string;
    disabled: boolean;
  };
  /** Currencies allowed for cards and for the reporting currency */
  currencies: string[];
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

export const createCard = (name: string, currency?: string) =>
  apiRequest<{ id: string }>('/group/cards', {
    method: 'POST',
    ...json(currency ? { name, currency } : { name }),
  });

/** The currency of a card can change only while it has no records (409 CARD_HAS_EXPENSES otherwise). */
export const updateCard = (
  id: string,
  patch: { name?: string; archived?: boolean; currency?: string },
) => apiRequest(`/group/cards/${id}`, { method: 'PATCH', ...json(patch) });

/** Replaces the access of all members: those not listed lose access to the card. */
export const setCardAccess = (id: string, access: Record<string, AccessLevel>) =>
  apiRequest(`/group/cards/${id}/access`, { method: 'PUT', ...json({ access }) });

export const createCategory = (name: string) =>
  apiRequest('/group/categories', { method: 'POST', ...json({ name }) });

export const updateCategory = (
  id: string,
  patch: { name?: string; archived?: boolean; mergeInto?: string },
) => apiRequest(`/group/categories/${id}`, { method: 'PATCH', ...json(patch) });

export const createInvitation = async (role: MemberRole) =>
  (await apiRequest<IssuedLink>('/group/invitations', { method: 'POST', ...json({ role }) })).data;

export const revokeInvitation = (id: string) =>
  apiRequest(`/group/invitations/${id}`, { method: 'DELETE' });

export const setMemberRole = (username: string, role: MemberRole) =>
  apiRequest(`${member(username)}/role`, { method: 'PUT', ...json({ role }) });

export const createMemberResetLink = async (username: string) =>
  (await apiRequest<IssuedLink>(`${member(username)}/reset-password`, { method: 'POST' })).data;

export const removeMember = (username: string) =>
  apiRequest(member(username), { method: 'DELETE' });

/** Changes the reporting currency; the server recalculates the records and says how many it touched. */
export const setReportingCurrency = async (currency: string) =>
  (
    await apiRequest<{ recalculated: number }>('/group/reporting-currency', {
      method: 'PUT',
      ...json({ currency }),
    })
  ).data;
