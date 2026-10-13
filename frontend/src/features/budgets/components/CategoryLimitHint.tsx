import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import { useBudgets } from '../hooks/useBudgets.ts';
import { projectBudget } from '../model/projection.ts';

const FILL = { ok: 'bg-indigo-500 dark:bg-indigo-400', warn: 'bg-amber-500', over: 'bg-red-500' };

interface CategoryLimitHintProps {
  category: string;
  /** The typed amount in the reporting currency; null when it is not typed or its rate is unknown */
  projected: number | null;
}

/**
 * Under the amount field: how much is left of the limit of the chosen category, with the typed amount counted in.
 * Nothing is shown for a category without a limit. A projected excess is only a calm warning, saving is not blocked.
 */
export function CategoryLimitHint({ category, projected }: CategoryLimitHintProps) {
  const budget = useBudgets().data?.find((item) => item.category === category);
  const config = useConfig().data;
  if (!budget || !config) return null;

  const digits = currencyDigits(budget.currency, config.baseCurrency);
  const money = (value: number) => `${formatAmount(value, digits)} ${budget.currency}`;
  const after = projectBudget(budget, projected);
  const fill = Math.min(Math.max(after.percent, 0), 100);
  const exceeded = after.remaining < 0;
  const willExceed = exceeded && projected !== null && projected > 0;

  return (
    <div className="space-y-1.5" aria-label="Лимит категории" role="group">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          {category} ·{' '}
          <span
            className={
              exceeded ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
            }
          >
            {exceeded
              ? `превышение ${money(-after.remaining)}`
              : `осталось ${money(after.remaining)}`}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
          {Math.round(after.percent)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`Лимит: ${category}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
        className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div className={`h-full rounded-full ${FILL[after.level]}`} style={{ width: `${fill}%` }} />
      </div>
      {willExceed && (
        <p role="status" className="text-sm text-red-600 dark:text-red-400">
          После покупки лимит категории будет превышен на {money(-after.remaining)}
        </p>
      )}
    </div>
  );
}
