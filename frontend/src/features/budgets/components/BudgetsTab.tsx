import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon, WarningIcon } from '../../../shared/ui/icons.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import type { BreakdownRow } from '../../analytics/api/analytics.api.ts';
import type { Budget } from '../api/budgets.api.ts';
import { LevelMark, LimitBar } from './limit-parts.tsx';
import { categoryIcon } from '../model/category-icon.tsx';
import { pluralCategories } from '../model/plural.ts';

/** Round icon background by level. */
const BADGE = {
  ok: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300',
  warn: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
  over: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
};

interface Format {
  /** A number without the currency */
  num: (value: number) => string;
  /** A number with the currency */
  money: (value: number) => string;
  currency: string;
}

/** The overall limit as a block of its own: spent of the limit, percent, bar and what is left. */
function OverallBlock({ budget, format }: { budget: Budget; format: Format }) {
  const over = budget.remaining < 0;
  return (
    <section
      aria-label="Общий бюджет"
      className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40"
    >
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Общий бюджет</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
        {/* The currency once, after the limit; the numbers never break */}
        <p className="whitespace-nowrap tabular-nums">
          <span className="text-2xl font-semibold">{format.num(budget.spent)}</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {' '}
            / {format.num(budget.limit)} {format.currency}
          </span>
        </p>
        <span className="text-xl font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">
          {Math.round(budget.percent)}%
        </span>
      </div>
      <LimitBar budget={budget} className="mt-2 h-2" />
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {over ? (
          <span className="text-red-600 dark:text-red-400">
            Превышение {format.money(-budget.remaining)}
          </span>
        ) : (
          <>Осталось {format.money(budget.remaining)} до конца периода</>
        )}
      </p>
    </section>
  );
}

/**
 * One category: a round icon, the name, «N% · осталось X», the bar; on the right «spent / limit» and the currency.
 * Everything is on one line each (no wrapping on a phone); a click opens the names of the category.
 */
function CategoryRow({
  budget,
  format,
  onSelect,
  selected = false,
}: {
  budget: Budget;
  format: Format;
  onSelect?: (category: string) => void;
  selected?: boolean;
}) {
  const over = budget.remaining < 0;
  const name = budget.category ?? '';
  const content = (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-x-2.5 gap-y-1">
      <span
        aria-hidden="true"
        className={`row-span-3 flex size-9 items-center justify-center rounded-full ${BADGE[budget.level]}`}
      >
        {categoryIcon(name)}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
      <span className="whitespace-nowrap text-right text-xs font-medium tabular-nums">
        {format.num(budget.spent)}
        <span className="font-normal text-zinc-500 dark:text-zinc-400">
          {' '}
          / {format.num(budget.limit)}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="row-span-3 text-zinc-400 transition group-hover/row:translate-x-0.5 group-hover/row:text-zinc-700 dark:group-hover/row:text-zinc-200"
      >
        {onSelect && <ChevronRightIcon />}
      </span>
      <div className="col-span-2 flex items-center justify-between gap-2 whitespace-nowrap text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          {budget.level === 'warn' && (
            <span className="text-amber-600 dark:text-amber-400">
              <WarningIcon />
            </span>
          )}
          {Math.round(budget.percent)}% ·{' '}
          {over ? (
            <span className="text-red-600 dark:text-red-400">
              превышение {format.num(-budget.remaining)}
            </span>
          ) : (
            <>осталось {format.num(budget.remaining)}</>
          )}
        </span>
        <span>{format.currency}</span>
      </div>
      <div className="col-span-2">
        <LimitBar budget={budget} />
      </div>
    </div>
  );

  return (
    <li>
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(name)}
          aria-label={`${name}: открыть наименования`}
          aria-current={selected || undefined}
          className={`group/row -mx-2 block w-[calc(100%+1rem)] cursor-pointer rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 active:bg-zinc-200/70 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800 ${
            selected
              ? 'bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900'
              : ''
          }`}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
}

const GROUP_TONES = {
  over: 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30',
  warn: 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30',
  plain: 'border-zinc-100 dark:border-zinc-800',
} as const;

/** A collapsible group of rows: the marker, the title, the count of categories and a chevron. */
function Group({
  title,
  count,
  tone,
  open = true,
  children,
}: {
  title: string;
  count: number;
  tone: keyof typeof GROUP_TONES;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className={`group rounded-xl border p-2.5 sm:p-3 ${GROUP_TONES[tone]}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <LevelMark tone={tone} />
        <span>{title}</span>
        <span className="font-normal text-zinc-500 dark:text-zinc-400">
          {count} {pluralCategories(count)}
        </span>
        <span aria-hidden="true" className="ml-auto text-zinc-400 transition group-open:rotate-180">
          <ChevronDownIcon />
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
  /** The category open in the names block */
  selected?: string;
  /** Whether a category passes the shared filters; the overall limit is always shown */
  isVisible?: (category: string) => boolean;
}

/** «Бюджет и лимиты»: the overall limit on top, categories grouped by how close they are to their limit. */
export function BudgetsTab({ budgets, rows, onSelect, selected, isVisible }: BudgetsTabProps) {
  const config = useConfig().data;
  if (!config) return null;

  const currency = budgets[0]?.currency ?? config.currency;
  const digits = currencyDigits(currency, config.baseCurrency);
  const num = (value: number) => formatAmount(value, digits);
  const format: Format = { num, money: (value) => `${num(value)} ${currency}`, currency };

  const overall = budgets.find((budget) => budget.categoryId === null);
  const shown = (name: string | null) => !isVisible || name === null || isVisible(name);
  const limited = budgets.filter((budget) => budget.categoryId !== null && shown(budget.category));
  const over = limited.filter((budget) => budget.level === 'over');
  const warn = limited.filter((budget) => budget.level === 'warn');
  const rest = limited.filter((budget) => budget.level === 'ok');
  // Categories that have a limit (visible or hidden by the filters) are not «without a limit»
  const names = new Set(
    budgets.filter((budget) => budget.categoryId !== null).map((budget) => budget.category),
  );
  const unlimited = (rows ?? []).filter(
    (row) => row.total > 0 && !names.has(row.key) && shown(row.key),
  );

  const list = (items: Budget[]) =>
    items.map((budget) => (
      <CategoryRow
        key={budget.id}
        budget={budget}
        format={format}
        onSelect={onSelect}
        selected={selected === budget.category}
      />
    ));

  return (
    <div className="space-y-3">
      {overall && <OverallBlock budget={overall} format={format} />}
      {over.length > 0 && (
        <Group title="Превышен лимит" count={over.length} tone="over">
          {list(over)}
        </Group>
      )}
      {warn.length > 0 && (
        <Group title="Близко к лимиту" count={warn.length} tone="warn">
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
                {format.money(row.total)}
              </span>
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}
