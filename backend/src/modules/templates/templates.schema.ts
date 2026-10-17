import { z } from 'zod';

/** Two decimals at most, like the expense amount. */
const hasTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

export const templateSchema = z.object({
  scope: z.enum(['personal', 'group'], { error: 'Выберите, кому виден шаблон' }),
  name: z
    .string({ error: 'Введите название кнопки' })
    .trim()
    .min(1, 'Введите название кнопки')
    .max(40, 'Название кнопки не длиннее 40 символов'),
  emoji: z
    .string()
    .trim()
    .max(8, 'Эмодзи: один символ')
    .nullish()
    .transform((value) => value || null),
  category: z.string({ error: 'Выберите категорию' }).trim().min(1, 'Выберите категорию'),
  card: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null),
  expenseName: z
    .string({ error: 'Введите наименование' })
    .trim()
    .min(1, 'Введите наименование')
    .max(255, 'Наименование не должно быть длиннее 255 символов'),
  amount: z
    .number({ error: 'Стоимость должна быть числом' })
    .positive('Стоимость должна быть больше нуля')
    .max(1_000_000_000, 'Слишком большая сумма')
    .refine(hasTwoDecimals, 'Стоимость: не более двух знаков после запятой')
    .nullish()
    .transform((value) => value ?? null),
  currency: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null),
});

export type TemplateBody = z.infer<typeof templateSchema>;

/** Editing never moves a template between the personal list and the group's, so the scope is not read. */
export const templateEditSchema = templateSchema.omit({ scope: true });

export const reorderSchema = z.object({ ids: z.array(z.uuid()).max(500) });
export const hiddenSchema = z.object({ hidden: z.boolean() });

export const TEMPLATE_ERROR_CODES: Record<string, string> = {
  scope: 'INVALID_SCOPE',
  name: 'INVALID_NAME',
  emoji: 'INVALID_EMOJI',
  category: 'INVALID_CATEGORY',
  expenseName: 'INVALID_NAME',
  amount: 'INVALID_AMOUNT',
};
