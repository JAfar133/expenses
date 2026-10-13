import { z } from 'zod';

/**
 * Settings the app remembers for a user. Keys and allowed values are fixed in advance:
 * arbitrary input never reaches the database. Values must match what the interface understands.
 */
export const preferencesSchema = z
  .object({
    /** Spending over time chart: bars, line, area */
    'daily.type': z.enum(['bars', 'line', 'area']),
    /** Per day or cumulative */
    'daily.mode': z.enum(['daily', 'cumulative']),
    /** Spending by category: bars, ring, pie (a stored legacy "columns" falls back to bars in the UI) */
    'category.type': z.enum(['bars', 'donut', 'pie']),
    /** Category card tab: limits or spending structure */
    'category.tab': z.enum(['limits', 'structure']),
    /** Categories by month: stacked or lines */
    'matrix.type': z.enum(['stacked', 'lines']),
    /** How many months to show in the comparison */
    'compare.months': z.enum(['6', '12', '24']),
    /** Currency in which to show amounts on the analytics page (everything is stored in drams) */
    'analytics.currency': z.enum(['AMD', 'RUB', 'USD', 'EUR']),
  })
  .partial()
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;
