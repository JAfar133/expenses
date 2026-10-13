import { apiRequest } from '../../../shared/api/http.ts';
import type { ItemInput } from '../../items/api/items.api.ts';

export interface CreateExpenseRequest {
  date: string;
  card: string;
  category: string;
  name: string;
  /** Amount in `currency`; a whole number in drams, otherwise at most 2 decimals */
  amount: number;
  /** Not specified: the currency of the card */
  currency?: string;
  /** Rate: drams per unit of the INPUT currency; needed when it is neither drams nor the card currency */
  rate?: number;
  /** Receipt positions entered with the expense */
  items?: ItemInput[];
  /** Sent only when the AI may parse the receipt: `default` means the person did not touch the field */
  nameSource?: 'default' | 'manual';
  dateSource?: 'default' | 'manual';
}

/** Original expense amount in a foreign currency. */
export interface ExpenseOriginal {
  amount: number;
  currency: string;
  rate: number;
}

export interface CreatedExpense extends Omit<CreateExpenseRequest, 'currency' | 'rate'> {
  id: string;
  /** `amount` is in the currency of the card (`currency`); the same expense in the group's reporting currency: */
  currency: string | null;
  reportingAmount: number;
  reportingCurrency: string | null;
  /** synced: the record is already in Excel, queued: waiting in the queue (file busy or OneDrive unavailable) */
  excelStatus: 'synced' | 'queued' | 'disabled';
  /** If another currency than the card's was typed, this holds the original amount and rate, otherwise null */
  original: ExpenseOriginal | null;
}

/** A card the user may add expenses to, with its currency. */
export interface Card {
  name: string;
  currency: string;
}

export const fetchCards = async () => (await apiRequest<Card[]>('/cards')).data;

export const fetchCategories = async () => (await apiRequest<string[]>('/categories')).data;

export interface AppConfig {
  /** Reporting currency of the group: totals and charts are in it */
  currency: string;
  /** Drams: the currency all rates are quoted against */
  baseCurrency: string;
}

export const fetchConfig = async (): Promise<AppConfig> => {
  const data = (await apiRequest<Partial<AppConfig> & { currency: string }>('/config')).data;
  return { currency: data.currency, baseCurrency: data.baseCurrency ?? 'AMD' };
};

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
