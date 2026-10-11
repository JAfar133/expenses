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
    .positive('Стоимость должна быть больше нуля'),
  /** Валюта суммы; не указана: базовая (драмы). Целую сумму в драммах и дробную в иностранной проверяет сервис */
  currency: z.string({ error: 'Выберите валюту' }).trim().min(1, 'Выберите валюту').optional(),
  /** Курс вручную (драммы за единицу валюты); не указан: курс ЦБ */
  rate: z
    .number({ error: 'Курс должен быть числом' })
    .positive('Курс должен быть больше нуля')
    .optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** Код ошибки по полю, которое не прошло проверку. */
export const FIELD_ERROR_CODES: Record<string, string> = {
  date: 'INVALID_DATE',
  card: 'INVALID_CARD',
  category: 'INVALID_CATEGORY',
  name: 'INVALID_NAME',
  amount: 'INVALID_AMOUNT',
  currency: 'INVALID_CURRENCY',
  rate: 'INVALID_RATE',
};
