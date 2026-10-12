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
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,1fr)_16rem]"
    >
      <span className="order-1 min-w-0 truncate text-sm font-medium">{label}</span>
      <span className="order-2 flex items-center justify-end gap-1 whitespace-nowrap text-right text-sm tabular-nums sm:order-3">
        {budget.level !== 'ok' && (
          <span className={ICON[budget.level]}>
            <WarningIcon />
          </span>
        )}
        {money(budget.spent)} / {money(budget.limit)} {currency}
        {budget.remaining < 0 && (
          <span className="text-red-600 dark:text-red-400">+{money(-budget.remaining)}</span>
        )}
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
  /** `card`: a card of its own (the add page); `inline`: a block inside another card (the category chart) */
  variant?: 'card' | 'inline';
}

/** Progress of the group's limits. Renders nothing when there are none: a group without limits looks as before. */
export function BudgetBars({ className = '', variant = 'card' }: BudgetBarsProps) {
  const budgets = useBudgets().data;
  const config = useConfig().data;
  if (!budgets || budgets.length === 0 || !config) return null;
  const digits = currencyDigits(config.currency, config.baseCurrency);

  const list = (
    <ul className="space-y-3">
      {budgets.map((budget) => (
        <BudgetRow key={budget.id} budget={budget} currency={config.currency} digits={digits} />
      ))}
    </ul>
  );

  if (variant === 'inline') {
    return (
      <section
        aria-label="Лимиты"
        className={`mb-4 space-y-2 border-b border-zinc-100 pb-4 dark:border-zinc-800 ${className}`}
      >
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Лимиты
        </h3>
        {list}
      </section>
    );
  }

  return (
    <section
      aria-label="Лимиты"
      className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900 ${className}`}
    >
      {list}
    </section>
  );
}
