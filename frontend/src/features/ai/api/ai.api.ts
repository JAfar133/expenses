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
