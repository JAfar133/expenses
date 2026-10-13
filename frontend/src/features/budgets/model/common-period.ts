import type { Budget } from '../api/budgets.api.ts';
import { periodWords } from './period.ts';

/** The words for a period of a limit: «месяц», «месяц с 5-го», «неделя». */
export const periodOf = (budget: Budget) => periodWords(budget.periodKind, budget.periodDay);

/** The period all limits share, as words; null when there are no limits or they differ. */
export function commonPeriod(budgets: Budget[]): string | null {
  const [first, ...rest] = budgets.map(periodOf);
  return first !== undefined && rest.every((words) => words === first) ? first : null;
}
