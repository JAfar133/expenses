import type { Budget } from '../api/budgets.api.ts';

export interface Projection {
  spent: number;
  remaining: number;
  percent: number;
  level: Budget['level'];
}

/**
 * The limit after a purchase: the typed amount (already in the currency of the limit; none if the rate is unknown)
 * is added to what is spent. Levels as on the server: warn from 80%, over from 100%.
 */
export function projectBudget(budget: Budget, extra: number | null): Projection {
  const spent = budget.spent + (extra ?? 0);
  const percent = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
  return {
    spent,
    remaining: budget.limit - spent,
    percent,
    level: percent >= 100 ? 'over' : percent >= 80 ? 'warn' : 'ok',
  };
}
