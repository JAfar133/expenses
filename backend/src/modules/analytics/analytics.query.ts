import type { AnalyticsFilters } from './analytics.types.ts';

export interface WhereClause {
  /** `WHERE …` или пустая строка */
  sql: string;
  params: unknown[];
}

/** Экранирует `%`, `_` и `\` для LIKE: пользователь ищет текст, а не шаблон. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Условие SQL по фильтрам. Значения всегда передаются параметрами ($1, $2, …),
 * в текст запроса подставляются только фиксированные фрагменты.
 */
export function buildWhere(
  filters: AnalyticsFilters,
  baseCurrency: string,
  firstParam = 1,
): WhereClause {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${firstParam + params.length - 1}`;
  };

  if (!filters.includeDeleted) conditions.push('deleted_at IS NULL');
  if (filters.from) conditions.push(`date >= ${param(filters.from)}`);
  if (filters.to) conditions.push(`date <= ${param(filters.to)}`);
  if (filters.cards.length) conditions.push(`card = ANY(${param(filters.cards)}::text[])`);
  if (filters.categories.length) {
    conditions.push(`category = ANY(${param(filters.categories)}::text[])`);
  }
  if (filters.createdBy.length) {
    conditions.push(`created_by = ANY(${param(filters.createdBy)}::text[])`);
  }
  if (filters.currencies.length) {
    conditions.push(
      `COALESCE(original_currency, ${param(baseCurrency)}) = ANY(${param(filters.currencies)}::text[])`,
    );
  }
  if (filters.q) conditions.push(`name ILIKE ${param(`%${escapeLike(filters.q)}%`)} ESCAPE '\\'`);
  if (filters.minAmount !== undefined) conditions.push(`amount >= ${param(filters.minAmount)}`);
  if (filters.maxAmount !== undefined) conditions.push(`amount <= ${param(filters.maxAmount)}`);

  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}
