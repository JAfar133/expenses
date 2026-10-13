import { apiRequest } from '../../../shared/api/http.ts';

export type ItemSource = 'manual' | 'ai';

/** A position of a receipt. `price` is the cost of the whole line. */
export interface ExpenseItem {
  id: string;
  position: number;
  name: string;
  price: number;
  quantity: number;
  source: ItemSource;
}

/** What is sent: `id` is kept for existing positions, otherwise their AI mark would be lost. */
export interface ItemInput {
  id?: string;
  name: string;
  price: number;
  quantity?: number;
}

export const fetchItems = async (expenseId: string) =>
  (await apiRequest<ExpenseItem[]>(`/expenses/${expenseId}/items`)).data;

/** Replaces the whole list. */
export const saveItems = async (expenseId: string, items: ItemInput[]) =>
  (
    await apiRequest<ExpenseItem[]>(`/expenses/${expenseId}/items`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    })
  ).data;
