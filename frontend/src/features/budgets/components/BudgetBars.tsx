import { WarningIcon } from '../../../shared/ui/icons.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import type { Budget } from '../api/budgets.api.ts';
import { useBudgets } from '../hooks/useBudgets.ts';

const FILL = {
  ok: 'bg-indigo-500 dark:bg-indigo-400',
  warn: 'bg-amber-500',
  over: 'bg-red-500',
};
const TEXT = {
  ok: '',
  warn: 'text-amber-700 dark:text-amber-400',
  over: 'text-red-600 dark:text-red-400',
};

const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function BudgetRow({
  budget,
  currency,
  digits,
}: {
  budget: Budget;
  currency: string;
  digits: number;
}) {
  const label = budget.category ?? 'Всего';
  const fill = Math.min(Math.max(budget.percent, 0), 100);
  const money = (value: number) => formatAmount(value, digits);

  return (
    <li
      title={`${shortDate(budget.period.from)}–${shortDate(budget.period.to)}`}
      className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
    >
      <span className="min-w-0 truncate text-sm font-medium sm:w-40 sm:shrink-0">{label}</span>
      <div
        role="progressbar"
        aria-label={`Лимит: ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className={`h-full rounded-full ${FILL[budget.level]}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span
        className={`flex items-center gap-1 whitespace-nowrap text-sm tabular-nums ${TEXT[budget.level]}`}
      >
        {budget.level !== 'ok' && <WarningIcon />}
        {money(budget.spent)} / {money(budget.limit)} {currency}
        {budget.remaining < 0 && (
          <strong className="font-semibold">+{money(-budget.remaining)}</strong>
        )}
      </span>
    </li>
  );
}

/** Progress of the group's limits. Renders nothing when there are none: a group without limits looks as before. */
export function BudgetBars({ className = '' }: { className?: string }) {
  const budgets = useBudgets().data;
  const config = useConfig().data;
  if (!budgets || budgets.length === 0 || !config) return null;
  const digits = currencyDigits(config.currency, config.baseCurrency);

  return (
    <section
      aria-label="Лимиты"
      className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900 ${className}`}
    >
      <ul className="space-y-3">
        {budgets.map((budget) => (
          <BudgetRow key={budget.id} budget={budget} currency={config.currency} digits={digits} />
        ))}
      </ul>
    </section>
  );
}
