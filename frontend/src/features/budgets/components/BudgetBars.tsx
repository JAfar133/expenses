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
const ICON = {
  ok: '',
  warn: 'text-amber-600 dark:text-amber-400',
  over: 'text-red-600 dark:text-red-400',
};

const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function BudgetRow({ budget, baseCurrency }: { budget: Budget; baseCurrency: string }) {
  const currency = budget.currency;
  const digits = currencyDigits(currency, baseCurrency);
  const label = budget.category ?? 'Всего';
  const fill = Math.min(Math.max(budget.percent, 0), 100);
  const money = (value: number) => `${formatAmount(value, digits)} ${currency}`;
  const over = budget.remaining < 0;

  return (
    <li
      title={`лимит ${money(budget.limit)} · ${shortDate(budget.period.from)}–${shortDate(budget.period.to)}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,1fr)_14rem]"
    >
      <span className="order-1 min-w-0 truncate text-sm font-medium">{label}</span>
      {/* Only what the chart does not say: how much of the limit is used and what is left (or exceeded) */}
      <span className="order-2 flex items-center justify-end gap-1.5 whitespace-nowrap text-right text-sm tabular-nums sm:order-3">
        {budget.level !== 'ok' && (
          <span className={ICON[budget.level]}>
            <WarningIcon />
          </span>
        )}
        <span>{Math.round(budget.percent)}%</span>
        <span
          className={over ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}
        >
          · {over ? `+${money(-budget.remaining)}` : `осталось ${money(budget.remaining)}`}
        </span>
      </span>
      <div
        role="progressbar"
        aria-label={`Лимит: ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
        className="order-3 col-span-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 sm:order-2 sm:col-span-1 dark:bg-zinc-800"
      >
        <div
          className={`h-full rounded-full ${FILL[budget.level]}`}
          style={{ width: `${fill}%` }}
        />
      </div>
    </li>
  );
}

interface BudgetBarsProps {
  className?: string;
  /** Currency to show amounts in (asked from the server); by default the group's reporting currency */
  currency?: string;
}

/** Progress of the group's limits. Renders nothing when there are none: a group without limits looks as before. */
export function BudgetBars({ className = '', currency }: BudgetBarsProps) {
  // The server sums in the requested currency: the numbers are shown as they come
  const budgets = useBudgets(currency).data;
  const config = useConfig().data;
  if (!budgets || budgets.length === 0 || !config) return null;

  const list = (
    <ul className="space-y-3">
      {budgets.map((budget) => (
        <BudgetRow key={budget.id} budget={budget} baseCurrency={config.baseCurrency} />
      ))}
    </ul>
  );

  return (
    <section
      aria-label="Лимиты"
      className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900 ${className}`}
    >
      {list}
    </section>
  );
}
