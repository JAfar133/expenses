import { apiRequest } from '../../../shared/api/http.ts';

export interface CreateExpenseRequest {
  date: string;
  card: string;
  category: string;
  name: string;
  amount: number;
}

export interface CreatedExpense extends CreateExpenseRequest {
  id: string;
  /** synced — запись уже в Excel, queued — ждёт в очереди (файл занят или OneDrive недоступен) */
  excelStatus: 'synced' | 'queued';
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
