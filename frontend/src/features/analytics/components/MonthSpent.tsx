import { Link } from 'react-router';
import { todayIso } from '../../../shared/utils/date.ts';
import { formatMoney } from '../../../shared/utils/money.ts';
import { useSummary } from '../hooks/useAnalytics.ts';
import { monthOf, monthRange } from '../model/periods.ts';

/** Ненавязчивая строка под формой: сколько потрачено в текущем месяце. При ошибке не показывается. */
export function MonthSpent({ currency }: { currency: string }) {
  const { data } = useSummary(monthRange(monthOf(todayIso())));
  if (!data) return null;

  return (
    <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
      В этом месяце потрачено{' '}
      <span className="font-medium text-zinc-700 dark:text-zinc-200">
        {formatMoney(data.current.total)} {currency}
      </span>
      {' · '}
      <Link to="/analytics" className="text-indigo-600 hover:underline dark:text-indigo-400">
        Анализ
      </Link>
    </p>
  );
}
