import { z } from 'zod';
import { AppError } from '../../errors/app-error.ts';
import {
  BREAKDOWN_DIMENSIONS,
  GRANULARITIES,
  SERIES_SPLITS,
  SORT_COLUMNS,
  type AnalyticsFilters,
} from './analytics.types.ts';

/** List in the address: `cards=Миша&cards=Настя` or `cards=Миша,Настя`. */
const list = z.preprocess(
  (value) => {
    if (value === undefined) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  },
  z.array(z.string().max(100)).max(50),
);

/** An empty value in the address (`?q=`) is treated as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const isoDate = z.iso.date({ error: 'Укажите дату в формате ГГГГ-ММ-ДД' });
const amountBound = z.coerce.number().int().min(0).max(2_147_483_647);

const filtersShape = {
  from: optional(isoDate),
  to: optional(isoDate),
  cards: list,
  categories: list,
  createdBy: list,
  currencies: list,
  q: optional(z.string().trim().max(100)),
  minAmount: optional(amountBound),
  maxAmount: optional(amountBound),
  includeDeleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
};

const withValidRanges = <T extends z.ZodType<AnalyticsFilters>>(schema: T) =>
  schema.superRefine((filters, context) => {
    if (filters.from && filters.to && filters.from > filters.to) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Конец периода раньше начала' });
    }
    if (
      filters.minAmount !== undefined &&
      filters.maxAmount !== undefined &&
      filters.minAmount > filters.maxAmount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maxAmount'],
        message: 'Максимум меньше минимума',
      });
    }
  });

const filtersSchema = withValidRanges(z.object(filtersShape));

const pagingShape = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

const schemas = {
  filters: filtersSchema,
  breakdown: withValidRanges(
    z.object({
      ...filtersShape,
      by: z.enum(BREAKDOWN_DIMENSIONS),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
  ),
  timeseries: withValidRanges(
    z.object({
      ...filtersShape,
      granularity: z.enum(GRANULARITIES).default('day'),
      splitBy: optional(z.enum(SERIES_SPLITS)),
    }),
  ),
  list: withValidRanges(
    z.object({
      ...filtersShape,
      sort: z.enum(SORT_COLUMNS).default('date'),
      direction: z.enum(['asc', 'desc']).default('desc'),
      ...pagingShape,
    }),
  ),
};

/** Parses the query parameters; on error responds with 400 and a clear message. */
export function parseQuery<K extends keyof typeof schemas>(
  kind: K,
  query: unknown,
): z.output<(typeof schemas)[K]> {
  const parsed = schemas[kind].safeParse(query);
  if (parsed.success) return parsed.data as z.output<(typeof schemas)[K]>;

  const issue = parsed.error.issues[0]!;
  const field = issue.path.join('.') || 'запрос';
  throw new AppError(400, 'INVALID_QUERY', `Некорректный параметр «${field}»: ${issue.message}`);
}
