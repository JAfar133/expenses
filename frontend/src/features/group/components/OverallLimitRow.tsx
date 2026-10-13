import { PencilIcon } from '../../../shared/ui/icons.tsx';
import type { Budget } from '../../budgets/api/budgets.api.ts';
import { periodOf } from '../../budgets/model/common-period.ts';

interface OverallLimitRowProps {
  budget: Budget | undefined;
  /** The amount with its currency */
  money: (value: number) => string;
  /** The period shared by all limits, shown once above the list */
  common: string | null;
  onEdit: () => void;
}

/** «Общий бюджет»: the limit for the whole group on top of the list; the pencil opens the same limit window. */
export function OverallLimitRow({ budget, money, common, onEdit }: OverallLimitRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Общий бюджет</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">на все категории</div>
      </div>
      <span className="text-sm tabular-nums">
        {budget ? (
          <>
            {money(budget.limit)}
            {common === null && (
              <span className="text-zinc-500 dark:text-zinc-400"> · {periodOf(budget)}</span>
            )}
          </>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-400">не задан</span>
        )}
      </span>
      <button
        type="button"
        aria-label="Лимит: Все категории"
        title="Лимит: Все категории"
        onClick={onEdit}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50 sm:size-9 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
      >
        <PencilIcon />
      </button>
    </div>
  );
}
