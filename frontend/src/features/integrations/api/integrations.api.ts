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
}

export type ImportStatus =
  'created' | 'parse_error' | 'unsupported' | 'card_not_found' | 'card_ambiguous' | 'error';

export interface BankImport {
  id: string;
  createdAt: string;
  source: string;
  status: ImportStatus;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  cardLast4: string | null;
  expenseId: string | null;
}

/** The address the iPhone automation calls (it is not used by this app). */
export const IMPORT_PATH = '/api/v1/transactions/import';

export const fetchApiKeys = async () => (await apiRequest<ApiKey[]>('/group/api-keys')).data;

/** The full key is in this answer only: the server never shows it again. */
export const createApiKey = async (name: string) =>
  (
    await apiRequest<{ id: string; key: string }>('/group/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  ).data;

export const revokeApiKey = (id: string) =>
  apiRequest(`/group/api-keys/${id}`, { method: 'DELETE' });

export const fetchImports = async () => (await apiRequest<BankImport[]>('/group/imports')).data;
