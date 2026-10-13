import { scopeCondition } from '../groups/scope.ts';
import type { AnalyticsFilters } from './analytics.types.ts';

/**
 * The expenses table with the card's current name (`card_label`): renaming a card in the `cards` table shows up
 * everywhere. The text column `card` is kept only for old records and for Excel.
 * `card_archived` and `category_archived` tell whether the card or the category is in the archive.
 */
export const EXPENSES_SOURCE = `(SELECT e.*, c.name AS card_label,
    (c.archived_at IS NOT NULL) AS card_archived, (cat.archived_at IS NOT NULL) AS category_archived
  FROM expenses e
  LEFT JOIN cards c ON c.id = e.card_id
  LEFT JOIN categories cat ON cat.group_id = e.group_id AND cat.name = e.category) expenses`;

/**
 * The amount of a record in the group's reporting currency (what charts and totals add up);
 * old records without it use the drams amount.
 */
export const AMOUNT_SQL = 'COALESCE(reporting_amount, amount)';

/**
 * The amount of a record in another currency (`currency` and `rate` are the placeholders of the query):
 * a record entered in it, kept on a card in it or reported in it counts with its exact amount; any other is
 * the drams amount divided by the rate of the day of the expense (the nearest known day, else the current rate).
 */
export const displayAmountSql = (currency: string, rate: string) => `(CASE
  WHEN original_currency = ${currency}::text THEN original_amount
  WHEN card_currency = ${currency}::text THEN card_amount
  WHEN reporting_currency = ${currency}::text THEN reporting_amount
  ELSE amount::numeric / COALESCE(
    (SELECT h.rate FROM exchange_rate_history h
      WHERE h.currency = ${currency}::text AND h.date <= expenses.date ORDER BY h.date DESC LIMIT 1),
    (SELECT h.rate FROM exchange_rate_history h
      WHERE h.currency = ${currency}::text AND h.date > expenses.date ORDER BY h.date LIMIT 1),
    ${rate}::numeric)
END)`;

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
  /** The SQL of a record's amount in the currency of the request (uses the parameters above) */
  amount: string;
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

  // The amount expression uses its own parameters: it is registered first and shared by the whole query
  const amount = filters.display
    ? displayAmountSql(param(filters.display.currency), param(filters.display.rate))
    : AMOUNT_SQL;

  if (filters.scope) conditions.push(scopeCondition(filters.scope, param));
  if (!filters.includeDeleted) conditions.push('deleted_at IS NULL');
  if (filters.from) conditions.push(`date >= ${param(filters.from)}`);
  if (filters.to) conditions.push(`date <= ${param(filters.to)}`);
  if (filters.cards.length)
    conditions.push(`${CARD_NAME_SQL} = ANY(${param(filters.cards)}::text[])`);
  if (filters.categories.length) {
    conditions.push(`category = ANY(${param(filters.categories)}::text[])`);
  }
  // Archived cards and categories are left out unless the user picked them in the filter or asked for the archive
  if (filters.excludeArchived) {
    if (!filters.cards.length) conditions.push('card_archived IS NOT TRUE');
    if (!filters.categories.length) conditions.push('category_archived IS NOT TRUE');
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
  if (filters.minAmount !== undefined) conditions.push(`${amount} >= ${param(filters.minAmount)}`);
  if (filters.maxAmount !== undefined) conditions.push(`${amount} <= ${param(filters.maxAmount)}`);

  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params, amount };
}
