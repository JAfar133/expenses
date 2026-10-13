import type { ReactNode } from 'react';
import { WarningIcon } from '../../../shared/ui/icons.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import type { BreakdownRow } from '../../analytics/api/analytics.api.ts';
import type { Budget } from '../api/budgets.api.ts';
import { pluralCategories } from '../model/plural.ts';

const FILL = {
  ok: 'bg-indigo-500 dark:bg-indigo-400',
  warn: 'bg-amber-500',
  over: 'bg-red-500',
};

interface Money {
  (value: number): string;
}

function Bar({ budget, className = 'h-1.5' }: { budget: Budget; className?: string }) {
  const fill = Math.min(Math.max(budget.percent, 0), 100);
  const label = budget.category ?? 'Всего';
  return (
    <div
      role="progressbar"
      aria-label={`Лимит: ${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill)}
      className={`overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800 ${className}`}
    >
      <div className={`h-full rounded-full ${FILL[budget.level]}`} style={{ width: `${fill}%` }} />
    </div>
  );
}

/** The overall limit as a block of its own: spent of the limit, percent, bar and what is left. */
function OverallBlock({ budget, money }: { budget: Budget; money: Money }) {
  const over = budget.remaining < 0;
  return (
    <section
      aria-label="Общий бюджет"
      className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40"
    >
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Общий бюджет</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="min-w-0 tabular-nums">
          <span className="text-2xl font-semibold">{money(budget.spent)}</span>
          <span className="text-zinc-500 dark:text-zinc-400"> / {money(budget.limit)}</span>
        </p>
        <span className="text-xl font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">
          {Math.round(budget.percent)}%
        </span>
      </div>
      <Bar budget={budget} className="mt-2 h-2" />
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {over ? (
          <span className="text-red-600 dark:text-red-400">
            Превышение {money(-budget.remaining)}
          </span>
        ) : (
          <>Осталось {money(budget.remaining)} до конца периода</>
        )}
      </p>
    </section>
  );
}

function CategoryRow({
  budget,
  money,
  onSelect,
}: {
  budget: Budget;
  money: Money;
  onSelect?: (category: string) => void;
}) {
  const over = budget.remaining < 0;
  const name = budget.category ?? '';
  return (
    <li className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(name)}
              className="max-w-full truncate text-left text-sm font-medium hover:underline"
            >
              {name}
            </button>
          ) : (
            <span className="block truncate text-sm font-medium">{name}</span>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {Math.round(budget.percent)}% ·{' '}
            {over ? (
              <span className="text-red-600 dark:text-red-400">
                превышение {money(-budget.remaining)}
              </span>
            ) : (
              <>осталось {money(budget.remaining)}</>
            )}
          </p>
        </div>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {money(budget.spent)}
          <span className="text-zinc-500 dark:text-zinc-400"> / {money(budget.limit)}</span>
        </span>
      </div>
      <Bar budget={budget} />
    </li>
  );
}

const GROUP_TONES = {
  over: 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30',
  warn: 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30',
  plain: 'border-zinc-100 dark:border-zinc-800',
} as const;

/** A collapsible group of rows: the title with the count of categories. */
function Group({
  title,
  count,
  tone,
  icon,
  open = true,
  children,
}: {
  title: string;
  count: number;
  tone: keyof typeof GROUP_TONES;
  icon?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className={`group rounded-xl border p-3 ${GROUP_TONES[tone]}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
        <span className="font-normal text-zinc-500 dark:text-zinc-400">
          {count} {pluralCategories(count)}
        </span>
        <span aria-hidden="true" className="ml-auto text-zinc-400 transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="mt-3 space-y-3">{children}</ul>
    </details>
  );
}

interface BudgetsTabProps {
  budgets: Budget[];
  /** Spending by category: the ones without a limit are listed from here */
  rows: BreakdownRow[] | undefined;
  onSelect?: (category: string) => void;
}

/** «Бюджет и лимиты»: the overall limit on top, categories grouped by how close they are to their limit. */
export function BudgetsTab({ budgets, rows, onSelect }: BudgetsTabProps) {
  const config = useConfig().data;
  if (!config) return null;

  const currency = budgets[0]?.currency ?? config.currency;
  const digits = currencyDigits(currency, config.baseCurrency);
  const money: Money = (value) => `${formatAmount(value, digits)} ${currency}`;

  const overall = budgets.find((budget) => budget.categoryId === null);
  const limited = budgets.filter((budget) => budget.categoryId !== null);
  const over = limited.filter((budget) => budget.level === 'over');
  const warn = limited.filter((budget) => budget.level === 'warn');
  const rest = limited.filter((budget) => budget.level === 'ok');
  const names = new Set(limited.map((budget) => budget.category));
  const unlimited = (rows ?? []).filter((row) => row.total > 0 && !names.has(row.key));

  const list = (items: Budget[]) =>
    items.map((budget) => (
      <CategoryRow key={budget.id} budget={budget} money={money} onSelect={onSelect} />
    ));

  return (
    <div className="space-y-3">
      {overall && <OverallBlock budget={overall} money={money} />}
      {over.length > 0 && (
        <Group
          title="Превышен лимит"
          count={over.length}
          tone="over"
          icon={
            <span className="text-red-600 dark:text-red-400">
              <WarningIcon />
            </span>
          }
        >
          {list(over)}
        </Group>
      )}
      {warn.length > 0 && (
        <Group
          title="Близко к лимиту"
          count={warn.length}
          tone="warn"
          icon={
            <span className="text-amber-600 dark:text-amber-400">
              <WarningIcon />
            </span>
          }
        >
          {list(warn)}
        </Group>
      )}
      {rest.length > 0 && (
        <Group title="Остальные категории" count={rest.length} tone="plain">
          {list(rest)}
        </Group>
      )}
      {unlimited.length > 0 && (
        <Group title="Без лимита" count={unlimited.length} tone="plain" open={false}>
          {unlimited.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{row.key}</span>
              <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                {money(row.total)}
              </span>
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}
