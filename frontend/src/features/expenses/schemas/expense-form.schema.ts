import { z } from 'zod';
import { parseAmount, parseDecimal } from '../../../shared/utils/money.ts';

/** Форма зависит от базовой валюты: в ней сумма целая, в остальных — с копейками и курсом. */
export function createExpenseFormSchema(baseCurrency: string) {
  return z
    .object({
      date: z.string().min(1, 'Укажите дату'),
      card: z.string().min(1, 'Выберите карту'),
      category: z.string().min(1, 'Выберите категорию'),
      name: z.string().trim().min(1, 'Введите наименование').max(255, 'Не более 255 символов'),
      currency: z.string().min(1, 'Выберите валюту'),
      amount: z.string(),
      /** Курс: драммы за единицу валюты; нужен только для иностранной валюты */
      rate: z.string(),
    })
    .superRefine((values, context) => {
      const isBase = values.currency === baseCurrency;

      const amountMessage = validateAmount(values.amount, isBase);
      if (amountMessage)
        context.addIssue({ code: 'custom', path: ['amount'], message: amountMessage });

      const rateMessage = isBase ? null : validateRate(values.rate);
      if (rateMessage) context.addIssue({ code: 'custom', path: ['rate'], message: rateMessage });
    });
}

export type ExpenseFormValues = z.infer<ReturnType<typeof createExpenseFormSchema>>;

function validateAmount(value: string, isBase: boolean): string | null {
  if (!value.trim()) {
    return 'Введите стоимость';
  }

  const amount = isBase ? parseAmount(value) : parseDecimal(value);
  if (amount === null) {
    return isBase ? 'Введите целое число' : 'Введите число';
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
