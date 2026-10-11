import { apiRequest } from '../../../shared/api/http.ts';

export interface CreateExpenseRequest {
  date: string;
  card: string;
  category: string;
  name: string;
  /** Сумма в валюте `currency`; в драммах целая */
  amount: number;
  /** Не указана: драммы */
  currency?: string;
  /** Курс: драммы за единицу валюты; нужен для иностранной валюты */
  rate?: number;
}

/** Исходная сумма расхода в иностранной валюте. */
export interface ExpenseOriginal {
  amount: number;
  currency: string;
  rate: number;
}

export interface CreatedExpense extends Omit<CreateExpenseRequest, 'currency' | 'rate'> {
  id: string;
  /** synced — запись уже в Excel, queued — ждёт в очереди (файл занят или OneDrive недоступен) */
  excelStatus: 'synced' | 'queued' | 'disabled';
  /** `amount` всегда в драммах; для иностранной валюты здесь исходная сумма и курс, иначе null */
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

/** Сколько раз наименование встречается в категории: основа для подсказок под полем «Наименование». */
export interface NameSuggestion {
  name: string;
  category: string;
  count: number;
}

/** Уже отсортированы от самых частых к редким. */
export const fetchNameSuggestions = async () =>
  (await apiRequest<NameSuggestion[]>('/name-suggestions')).data;

export interface RatesResponse {
  /** Базовая валюта: в ней ведётся учёт */
  base: string;
  /** Валюты, в которых можно вводить расходы */
  currencies: string[];
  /** Драммы за единицу валюты; для валюты без курса записи нет */
  rates: { currency: string; rate: number; fetchedAt: string }[];
}

export const fetchRates = async () => (await apiRequest<RatesResponse>('/rates')).data;
