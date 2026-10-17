import { apiRequest } from '../../../shared/api/http.ts';

export interface Recipient {
  id: string;
  name: string;
  group: string | null;
  role: 'owner' | 'member' | null;
  groupId: string | null;
}

export interface Recipients {
  canSendToAll: boolean;
  users: Recipient[];
}

export type BroadcastScope = 'group' | 'users' | 'all';

export interface Broadcast {
  id: string;
  scope: BroadcastScope;
  title: string;
  body: string;
  recipients: number;
  createdAt: string;
}

export type Audience = { type: 'group' } | { type: 'all' } | { type: 'users'; userIds: string[] };

export const fetchRecipients = async () =>
  (await apiRequest<Recipients>('/notifications/recipients')).data;

export const fetchBroadcasts = async () =>
  (await apiRequest<Broadcast[]>('/notifications/broadcasts')).data;

export const sendBroadcast = async (input: { text: string; title?: string; audience: Audience }) =>
  (
    await apiRequest<{ id: string; recipients: number }>('/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).data;
