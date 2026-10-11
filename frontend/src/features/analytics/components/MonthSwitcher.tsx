import { monthLabel, shiftMonth, type MonthKey } from '../model/periods.ts';

interface MonthSwitcherProps {
  month: MonthKey;
  /** Current month: cannot switch past it */
  latest: MonthKey;
  onChange: (month: MonthKey) => void;
}

const arrowClass =
  'flex size-10 items-center justify-center rounded-full text-lg text-zinc-600 hover:bg-zinc-200/70 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800';

/** Month switcher: arrows and the name. */
export function MonthSwitcher({ month, latest, onChange }: MonthSwitcherProps) {
  return (
    <div className="flex w-full items-center gap-1 sm:w-auto">
      <button
        type="button"
        aria-label="Предыдущий месяц"
        className={arrowClass}
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        ‹
      </button>
      <h2
        className="min-w-36 flex-1 text-center text-lg font-semibold sm:flex-none"
        aria-live="polite"
      >
        {monthLabel(month)}
      </h2>
      <button
        type="button"
        aria-label="Следующий месяц"
        className={arrowClass}
        disabled={month >= latest}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        ›
      </button>
    </div>
  );
}
