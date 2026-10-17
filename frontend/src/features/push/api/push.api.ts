import { apiRequest } from '../../../shared/api/http.ts';

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

/** One device of the person (the address and keys of the subscription never come back from the server). */
export interface PushDevice {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  failures: number;
}

export interface NotificationSettings {
  push: {
    types: {
      expense_imported: boolean;
      import_problem: boolean;
      receipt_parsed: boolean;
      announcement: boolean;
    };
    hideAmounts: boolean;
  };
}

export type NotificationSettingsPatch = {
  push?: {
    types?: Partial<NotificationSettings['push']['types']>;
    hideAmounts?: boolean;
  };
};

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const fetchPushConfig = async () => (await apiRequest<PushConfig>('/push/config')).data;

export const fetchPushDevices = async () =>
  (await apiRequest<PushDevice[]>('/push/subscriptions')).data;

export const createPushSubscription = async (input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label?: string;
}) =>
  (await apiRequest<{ id: string }>('/push/subscriptions', { method: 'POST', ...json(input) }))
    .data;

export const deletePushDevice = (id: string) =>
  apiRequest(`/push/subscriptions/${id}`, { method: 'DELETE' });

/** By the address of this browser's subscription: for the logout. */
export const unsubscribePush = (endpoint: string) =>
  apiRequest('/push/subscriptions/unsubscribe', { method: 'POST', ...json({ endpoint }) });

export const fetchNotificationSettings = async () =>
  (await apiRequest<NotificationSettings>('/notifications/settings')).data;

export const saveNotificationSettings = (patch: NotificationSettingsPatch) =>
  apiRequest('/notifications/settings', { method: 'PUT', ...json(patch) });
