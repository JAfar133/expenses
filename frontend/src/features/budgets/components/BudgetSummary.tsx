import { Link } from 'react-router';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import type { Budget } from '../api/budgets.api.ts';
import { capitalize } from '../../../shared/utils/text.ts';
import { useBudgets } from '../hooks/useBudgets.ts';
import { LevelMark, LimitBar } from './limit-parts.tsx';

const FILL = { ok: 'bg-indigo-500 dark:bg-indigo-400', warn: 'bg-amber-500', over: 'bg-red-500' };
/** How many categories under the overall limit; the rest is «и ещё N» */
const MAX_ROWS = 3;

const titleOf = (budget: Budget) =>
  budget.periodKind === 'month'
    ? 'Бюджет месяца'
    : budget.periodKind === 'week'
      ? 'Бюджет недели'
      : 'Бюджет периода';

/**
 * Under the add form: the overall limit (spent, bar, what is left) and, below, only the categories that are over
 * their limit or close to it (80% and more), at most three. Nothing at all when there is nothing to say.
 */
export function BudgetSummary({ className = '' }: { className?: string }) {
  const budgets = useBudgets().data;
  const config = useConfig().data;
  if (!budgets || !config) return null;

  const overall = budgets.find((budget) => budget.categoryId === null);
  const warnings = budgets
    .filter((budget) => budget.categoryId !== null && budget.level !== 'ok')
    // The exceeded ones first
    .sort((a, b) => Number(b.level === 'over') - Number(a.level === 'over'));
  if (!overall && warnings.length === 0) return null;

  const money = (budget: Budget, value: number) =>
    `${formatAmount(value, currencyDigits(budget.currency, config.baseCurrency))} ${budget.currency}`;
  const shown = warnings.slice(0, MAX_ROWS);
  const more = warnings.length - shown.length;

  return (
    <section
      aria-label="Бюджет"
      className={`space-y-2.5 rounded-2xl bg-white p-3.5 shadow-sm dark:bg-zinc-900 ${className}`}
    >
      {overall && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">{titleOf(overall)}</h3>
            <span className="text-sm tabular-nums">
              <span className="font-semibold">{money(overall, overall.spent)}</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {' '}
                / {money(overall, overall.limit)}
              </span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Общий лимит"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(Math.max(overall.percent, 0), 100))}
            className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              className={`h-full rounded-full ${FILL[overall.level]}`}
              style={{ width: `${Math.min(Math.max(overall.percent, 0), 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>{Math.round(overall.percent)}%</span>
            {overall.remaining < 0 ? (
              <span className="text-red-600 dark:text-red-400">
                Превышение {money(overall, -overall.remaining)}
              </span>
            ) : (
              <span>Осталось {money(overall, overall.remaining)}</span>
            )}
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {shown.map((budget) => {
            const over = budget.remaining < 0;
            return (
              <li key={budget.id} className="flex items-center gap-2.5 py-2 first:pt-0">
                <span className="flex w-5 shrink-0 justify-center">
                  <LevelMark tone={budget.level === 'over' ? 'over' : 'warn'} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-medium">
                    {capitalize(budget.category ?? '')}
                  </div>
                  <LimitBar budget={budget} className="h-1" />
                </div>
                <div className="shrink-0 text-right leading-tight">
                  {over ? (
                    <div className="text-sm font-medium tabular-nums text-red-600 dark:text-red-400">
                      +{money(budget, -budget.remaining)}
                    </div>
                  ) : (
                    <div className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                      осталось {money(budget, budget.remaining)}
                    </div>
                  )}
                  <div className="text-[11px] tabular-nums text-zinc-400">
                    {Math.round(budget.percent)}%
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        to="/analytics"
        className="inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {more > 0 ? `Все лимиты (${more}) →` : 'Все лимиты →'}
      </Link>
    </section>
  );
}
