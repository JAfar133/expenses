import { apiRequest } from '../../../shared/api/http.ts';

export interface AiStatus {
  /** The administrator turned the AI on and the key is set */
  installationReady: boolean;
  /** The owner turned it on for the group */
  groupEnabled: boolean;
  /** Both: the receipt can be parsed */
  available: boolean;
}

export const fetchAiStatus = async () => (await apiRequest<AiStatus>('/ai/status')).data;

/** Owner only. */
export const setGroupAi = (enabled: boolean) =>
  apiRequest('/group/ai', { method: 'PUT', body: JSON.stringify({ enabled }) });

export interface ParseResult {
  nameFilled: boolean;
  dateFilled: boolean;
  itemsFilled: boolean;
  /** The receipt has positions, but the list was not touched (a person edited it): they can be offered */
  itemsOffered: boolean;
  dropped: number;
  total: number | null;
  currency: string | null;
}

export const parseReceipt = async (expenseId: string, replaceItems = false) =>
  (
    await apiRequest<ParseResult>(`/expenses/${expenseId}/receipt/parse`, {
      method: 'POST',
      body: JSON.stringify({ replaceItems }),
    })
  ).data;

/** «Accept»: the AI marks go away, the values stay. */
export const acceptAi = (expenseId: string) =>
  apiRequest(`/expenses/${expenseId}/ai`, { method: 'DELETE' });

/** What the AI read from a receipt photo before the expense is saved: nothing is stored on the server. */
export interface PhotoParse {
  /** Goes to POST /expenses as `aiParseId`: the server marks as AI what is saved exactly as read */
  parseId: string;
  name: string | null;
  /** YYYY-MM-DD, only a plausible one */
  date: string | null;
  items: { name: string; price: number; quantity: number }[];
  total: number | null;
  currency: string | null;
  dropped: number;
}

/** The photo is sent as it is (already compressed by the client). */
export const parseReceiptPhoto = async (photo: Blob, category: string) =>
  (
    await apiRequest<PhotoParse>(`/ai/receipt/parse?category=${encodeURIComponent(category)}`, {
      method: 'POST',
      headers: { 'Content-Type': photo.type || 'image/jpeg' },
      body: photo,
    })
  ).data;
