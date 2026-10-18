import { apiRequest } from '../../../shared/api/http.ts';

export interface ApiKey {
  id: string;
  name: string;
  /** The first characters of the key, e.g. «etk_ab12»: the rest is never readable again */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  /** The category of expenses from this key when the group has no earlier expense of such a merchant; null: not set */
  defaultCategory: string | null;
}

export type LogStatus =
  | 'created'
  | 'duplicate'
  | 'merged'
  | 'unrecognized'
  | 'parse_error'
  | 'unsupported'
  | 'card_not_found'
  | 'card_ambiguous'
  | 'unknown_source'
  | 'invalid_request'
  | 'error';

/** What the server read from a request. */
export interface ParsedImport {
  amount: number;
  currency: string;
  merchant: string;
  occurredAt: string;
  localDate: string;
  cardLast4?: string;
  cardHint?: string;
  categoryHint?: string;
  transactionId?: string;
}

/** With which earlier record a request was joined, or which Wallet requests a bank notice took over. */
export type ImportMatch =
  | {
      reason: 'merchant' | 'card' | 'same request';
      source: string;
      importId: string;
      expenseId: string;
      renamed?: { from: string; to: string };
    }
  | { mergedWalletEvents: string[] };

/** One authorised request to the import endpoint, as the server logged it (kept for 30 days). */
export interface ImportLogEntry {
  id: string;
  receivedAt: string;
  source: string;
  keyName: string | null;
  status: LogStatus;
  error: string | null;
  /** The whole JSON as it came, with unknown fields and `device` */
  rawPayload: Record<string, unknown>;
  parsed: ParsedImport | null;
  match: ImportMatch | null;
  expenseId: string | null;
  /** The request may be processed again (the key still exists and nothing has been created from it) */
  retryable?: boolean;
}

/** The address the iPhone automation calls (it is not used by this app). */
export const IMPORT_PATH = '/api/v1/transactions/import';

export const fetchApiKeys = async () => (await apiRequest<ApiKey[]>('/group/api-keys')).data;

/** The full key is in this answer only: the server never shows it again. */
export const createApiKey = async (input: { name: string; defaultCategory?: string }) =>
  (
    await apiRequest<{ id: string; key: string }>('/group/api-keys', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).data;

/** `defaultCategory: null` clears the category. */
export const updateApiKey = (
  id: string,
  patch: { name?: string; defaultCategory?: string | null },
) => apiRequest(`/group/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const revokeApiKey = (id: string) =>
  apiRequest(`/group/api-keys/${id}`, { method: 'DELETE' });

/** The log of the import endpoint, newest first; `source` narrows it. */
export const fetchImportLog = async (source?: string) =>
  (
    await apiRequest<ImportLogEntry[]>(
      `/group/import-log?limit=30${source ? `&source=${encodeURIComponent(source)}` : ''}`,
    )
  ).data;

/** One request of the log with its `retryable` flag (a 404 or 403 means it is gone: the log is kept for 30 days). */
export const fetchImportLogEntry = async (id: string) =>
  (await apiRequest<ImportLogEntry>(`/group/import-log/${encodeURIComponent(id)}`)).data;

export interface RetryResult {
  status: string;
  transactionId?: string;
  message?: string;
}

/** Processes a logged request once more; the answer says what came out of it. */
export const retryImportLogEntry = async (id: string) =>
  (
    await apiRequest<RetryResult>(`/group/import-log/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    })
  ).data;
