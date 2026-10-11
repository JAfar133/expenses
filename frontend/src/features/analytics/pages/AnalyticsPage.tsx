import { useSearchParams } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { todayIso } from '../../../shared/utils/date.ts';
import { formatMoney } from '../../../shared/utils/money.ts';
import { CategoryChart } from '../components/CategoryChart.tsx';
import { DailyChart } from '../components/DailyChart.tsx';
import { MonthSwitcher } from '../components/MonthSwitcher.tsx';
import { StatTile } from '../components/StatTile.tsx';
import { useAnalyticsReference } from '../hooks/useAnalyticsReference.ts';
import { useBreakdown, useSummary, useTimeseries } from '../hooks/useAnalytics.ts';
import { changePercent } from '../model/chart-data.ts';
import { isMonthKey, monthOf, monthRange } from '../model/periods.ts';

/** Страница анализа: обзор выбранного месяца. Месяц хранится в адресе (`?month=2026-10`). */
export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const latest = monthOf(todayIso());
  const requested = params.get('month');
  const month = isMonthKey(requested) && requested <= latest ? requested : latest;

  const filters = monthRange(month);
  const { currency, categoryOrder } = useAnalyticsReference();

  const summary = useSummary(filters);
  const daily = useTimeseries(filters, 'day');
  const categories = useBreakdown(filters, 'category');

  const current = summary.data?.current;
  const previous = summary.data?.previous ?? undefined;
  const money = (value: number | undefined) =>
    value === undefined ? '…' : `${formatMoney(Math.round(value))} ${currency}`;
  const note = current ? `к предыдущим ${current.days} дн.` : undefined;

  return (
    <div className="space-y-4">
      <MonthSwitcher
        month={month}
        latest={latest}
        onChange={(next) => setParams(next === latest ? {} : { month: next })}
      />

      {summary.isError && (
        <Notice variant="error">
          Не удалось загрузить данные.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => void summary.refetch()}
          >
            Повторить
          </button>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Потрачено"
          value={money(current?.total)}
          change={current && changePercent(current.total, previous?.total)}
          changeNote={note}
        />
        <StatTile
          label="В день"
          value={money(current?.perDay)}
          change={current && changePercent(current.perDay, previous?.perDay)}
          changeNote={note}
        />
        <StatTile
          label="Операций"
          value={current ? String(current.count) : '…'}
          change={current && changePercent(current.count, previous?.count)}
          changeNote={note}
        />
        <StatTile label="Средний чек" value={money(current?.average)} />
        <StatTile label="Самая крупная" value={money(current?.max)} />
      </div>

      <DailyChart points={daily.data} currency={currency} loading={daily.isPending} />
      <CategoryChart
        rows={categories.data}
        currency={currency}
        categoryOrder={categoryOrder}
        loading={categories.isPending}
      />
    </div>
  );
}
