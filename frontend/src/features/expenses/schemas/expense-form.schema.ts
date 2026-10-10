import { z } from 'zod';
import { parseAmount } from '../../../shared/utils/money.ts';

export const expenseFormSchema = z.object({
  date: z.string().min(1, 'Укажите дату'),
  card: z.string().min(1, 'Выберите карту'),
  category: z.string().min(1, 'Выберите категорию'),
  name: z.string().trim().min(1, 'Введите наименование').max(255, 'Не более 255 символов'),
  amount: z.string().superRefine((value, context) => {
    const message = validateAmount(value);
    if (message) {
      context.addIssue({ code: 'custom', message });
    }
  }),
});

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

function validateAmount(value: string): string | null {
  if (!value.trim()) {
    return 'Введите стоимость';
  }

  const amount = parseAmount(value);
  if (amount === null) {
    return 'Введите целое число';
  }
  return amount > 0 ? null : 'Стоимость должна быть больше нуля';
}
