import { apiRequest } from '../../../shared/api/http.ts';

export interface ReceiptSettings {
  enabled: boolean;
  /** Names of the categories where a photo may be attached */
  categories: string[];
}

export const fetchReceiptSettings = async () =>
  (await apiRequest<ReceiptSettings>('/receipts/settings')).data;

/** Owner only. */
export const saveReceiptSettings = (settings: ReceiptSettings) =>
  apiRequest('/group/receipts', { method: 'PUT', body: JSON.stringify(settings) });

/** Raw JPEG body: the server checks the first bytes. A new photo replaces the previous one. */
export const uploadReceipt = (expenseId: string, photo: Blob) =>
  apiRequest(`/expenses/${expenseId}/receipt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: photo,
  });

export const deleteReceipt = (expenseId: string) =>
  apiRequest(`/expenses/${expenseId}/receipt`, { method: 'DELETE' });

/** The photo is served with the session cookie, so it can be used as an image source. `version` bypasses the cache after a replace. */
export const receiptUrl = (expenseId: string, version = 0) =>
  `/api/expenses/${expenseId}/receipt${version ? `?v=${version}` : ''}`;
