import { apiRequest } from '../../../shared/api/http.ts';

export interface CreateExpenseRequest {
  date: string;
  card: string;
  category: string;
  name: string;
  /** Amount in `currency`; a whole number in drams */
  amount: number;
  /** Not specified: drams */
  currency?: string;
  /** Rate: drams per unit of currency; needed for a foreign currency */
  rate?: number;
}

/** Original expense amount in a foreign currency. */
export interface ExpenseOriginal {
  amount: number;
  currency: string;
  rate: number;
}

export interface CreatedExpense extends Omit<CreateExpenseRequest, 'currency' | 'rate'> {
  id: string;
  /** synced: the record is already in Excel, queued: waiting in the queue (file busy or OneDrive unavailable) */
  excelStatus: 'synced' | 'queued' | 'disabled';
  /** `amount` is always in drams; for a foreign currency this holds the original amount and rate, otherwise null */
  original: ExpenseOriginal | null;
}

export const fetchCards = async () => (await apiRequest<string[]>('/cards')).data;

export const fetchCategories = async () => (await apiRequest<string[]>('/categories')).data;

export const fetchCurrency = async () =>
  (await apiRequest<{ currency: string }>('/config')).data.currency;

export async function createExpense(expense: CreateExpenseRequest, idempotencyKey: string) {
  const response = await apiRequest<CreatedExpense>('/expenses', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(expense),
  });
  return response.data;
}

/** How many times a name occurs in a category: the basis for suggestions under the name field. */
export interface NameSuggestion {
  name: string;
  category: string;
  count: number;
}

/** Already sorted from most to least frequent. */
export const fetchNameSuggestions = async () =>
  (await apiRequest<NameSuggestion[]>('/name-suggestions')).data;

export interface RatesResponse {
  /** Base currency: accounting is kept in it */
  base: string;
  /** Currencies in which expenses can be entered */
  currencies: string[];
  /** Drams per unit of currency; no entry for a currency without a rate */
  rates: { currency: string; rate: number; fetchedAt: string }[];
}

export const fetchRates = async () => (await apiRequest<RatesResponse>('/rates')).data;
