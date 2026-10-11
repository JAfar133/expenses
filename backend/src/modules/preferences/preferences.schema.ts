import { z } from 'zod';

/**
 * Настройки, которые приложение запоминает для пользователя. Ключи и допустимые значения заданы заранее:
 * в базу не попадает произвольный ввод. Значения должны совпадать с теми, что понимает интерфейс.
 */
export const preferencesSchema = z
  .object({
    /** График расходов по времени: столбики, линия, область */
    'daily.type': z.enum(['bars', 'line', 'area']),
    /** За день или накопительно */
    'daily.mode': z.enum(['daily', 'cumulative']),
    /** Расход по категориям: полосы, столбики, кольцо, круг */
    'category.type': z.enum(['bars', 'columns', 'donut', 'pie']),
    /** Категории по месяцам: с накоплением или линии */
    'matrix.type': z.enum(['stacked', 'lines']),
    /** Сколько месяцев показывать в сравнении */
    'compare.months': z.enum(['6', '12', '24']),
    /** В какой валюте показывать суммы на странице анализа (в базе всё хранится в драммах) */
    'analytics.currency': z.enum(['AMD', 'RUB', 'USD', 'EUR']),
    /** Панель фильтров раскрыта или свёрнута */
    'filters.panel': z.enum(['open', 'closed']),
  })
  .partial()
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;
