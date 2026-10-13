import { formatDecimalInput } from '../../../shared/utils/money.ts';
import type { ExpenseFormValues } from '../../expenses/schemas/expense-form.schema.ts';
import type { QueuedExpense } from './queue-types.ts';

/** The values of the form for an expense taken back from the queue (the reverse of what the form sends). */
export function draftToFormValues(
  { expense }: QueuedExpense,
  baseCurrency: string,
  cardCurrency: string,
): ExpenseFormValues {
  const currency = expense.currency ?? cardCurrency;
  const amount = formatDecimalInput(String(expense.amount), { maxDecimals: 2, group: true });
  return {
    date: expense.date,
    card: expense.card,
    category: expense.category,
    name: expense.name,
    currency,
    amount,
    rate:
      expense.rate === undefined
        ? ''
        : formatDecimalInput(String(expense.rate), { maxDecimals: 6 }),
  };
}
