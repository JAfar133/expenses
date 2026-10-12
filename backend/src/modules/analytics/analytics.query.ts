import { scopeCondition } from '../groups/scope.ts';
import type { AnalyticsFilters } from './analytics.types.ts';

/**
 * The expenses table with the card's current name (`card_label`): renaming a card in the `cards` table shows up
 * everywhere. The text column `card` is kept only for old records and for Excel.
 */
export const EXPENSES_SOURCE =
  '(SELECT e.*, c.name AS card_label FROM expenses e LEFT JOIN cards c ON c.id = e.card_id) expenses';

/**
 * The amount of a record in the group's reporting currency (what charts and totals add up);
 * old records without it use the drams amount.
 */
export const AMOUNT_SQL = 'COALESCE(reporting_amount, amount)';

/**
 * The currency a record was entered in: what the user typed when it differs from the card (original_currency),
 * otherwise the currency of its card (drams for records without it). This is what the currency filter and the
 * breakdown by currency use.
 */
export const CURRENCY_SQL = (baseParam: string) =>
  `COALESCE(original_currency, card_currency, ${baseParam})`;

/** The card name in queries over `EXPENSES_SOURCE`. */
export const CARD_NAME_SQL = 'COALESCE(card_label, card)';

export interface WhereClause {
  /** `WHERE …` or an empty string */
  sql: string;
  params: unknown[];
}

/** Escapes `%`, `_` and `\` for LIKE: the user searches for text, not a pattern. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * SQL condition for the filters. Values are always passed as parameters ($1, $2, …),
 * only fixed fragments are put into the query text.
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

  if (filters.scope) conditions.push(scopeCondition(filters.scope, param));
  if (!filters.includeDeleted) conditions.push('deleted_at IS NULL');
  if (filters.from) conditions.push(`date >= ${param(filters.from)}`);
  if (filters.to) conditions.push(`date <= ${param(filters.to)}`);
  if (filters.cards.length)
    conditions.push(`${CARD_NAME_SQL} = ANY(${param(filters.cards)}::text[])`);
  if (filters.categories.length) {
    conditions.push(`category = ANY(${param(filters.categories)}::text[])`);
  }
  if (filters.createdBy.length) {
    conditions.push(`created_by = ANY(${param(filters.createdBy)}::text[])`);
  }
  if (filters.currencies.length) {
    conditions.push(
      `${CURRENCY_SQL(param(baseCurrency))} = ANY(${param(filters.currencies)}::text[])`,
    );
  }
  if (filters.q) conditions.push(`name ILIKE ${param(`%${escapeLike(filters.q)}%`)} ESCAPE '\\'`);
  if (filters.minAmount !== undefined)
    conditions.push(`${AMOUNT_SQL} >= ${param(filters.minAmount)}`);
  if (filters.maxAmount !== undefined)
    conditions.push(`${AMOUNT_SQL} <= ${param(filters.maxAmount)}`);

  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}
