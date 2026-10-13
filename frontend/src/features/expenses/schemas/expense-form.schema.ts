import { z } from 'zod';
import { parseDecimal } from '../../../shared/utils/money.ts';

/**
 * The form depends on the base currency (drams: a whole amount, no rate) and on the card currencies:
 * the rate is asked only when the typed currency is neither drams nor the currency of the card.
 */
export function createExpenseFormSchema(
  baseCurrency: string,
  cardCurrencies: Record<string, string> = {},
) {
  return z
    .object({
      date: z.string().min(1, 'Укажите дату'),
      card: z.string().min(1, 'Выберите карту'),
      category: z.string().min(1, 'Выберите категорию'),
      name: z.string().trim().min(1, 'Введите наименование').max(255, 'Не более 255 символов'),
      currency: z.string().min(1, 'Выберите валюту'),
      amount: z.string(),
      /** Rate: drams per unit of the typed currency */
      rate: z.string(),
    })
    .superRefine((values, context) => {
      const isBase = values.currency === baseCurrency;

      const amountMessage = validateAmount(values.amount);
      if (amountMessage)
        context.addIssue({ code: 'custom', path: ['amount'], message: amountMessage });

      const needsRate = !isBase && values.currency !== cardCurrencies[values.card];
      const rateMessage = needsRate ? validateRate(values.rate) : null;
      if (rateMessage) context.addIssue({ code: 'custom', path: ['rate'], message: rateMessage });
    });
}

export type ExpenseFormValues = z.infer<ReturnType<typeof createExpenseFormSchema>>;

function validateAmount(value: string): string | null {
  if (!value.trim()) {
    return 'Введите стоимость';
  }

  // Every currency, drams included, takes up to two decimals
  const amount = parseDecimal(value);
  if (amount === null) {
    return 'Введите число';
  }
  return amount > 0 ? null : 'Стоимость должна быть больше нуля';
}

function validateRate(value: string): string | null {
  if (!value.trim()) {
    return 'Укажите курс';
  }

  const rate = parseDecimal(value);
  if (rate === null) {
    return 'Введите курс числом';
  }
  return rate > 0 ? null : 'Курс должен быть больше нуля';
}
