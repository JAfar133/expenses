import { z } from 'zod';

export const createExpenseSchema = z.object({
  date: z.iso.date({ error: 'Укажите корректную дату' }),
  card: z.string({ error: 'Выберите карту' }).trim().min(1, 'Выберите карту'),
  category: z.string({ error: 'Выберите категорию' }).trim().min(1, 'Выберите категорию'),
  name: z
    .string({ error: 'Введите наименование' })
    .trim()
    .min(1, 'Введите наименование')
    .max(255, 'Наименование не должно быть длиннее 255 символов'),
  amount: z
    .number({ error: 'Стоимость должна быть числом' })
    .int('Стоимость должна быть целым числом')
    .positive('Стоимость должна быть больше нуля'),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** Код ошибки по полю, которое не прошло проверку. */
export const FIELD_ERROR_CODES: Record<string, string> = {
  date: 'INVALID_DATE',
  card: 'INVALID_CARD',
  category: 'INVALID_CATEGORY',
  name: 'INVALID_NAME',
  amount: 'INVALID_AMOUNT',
};
