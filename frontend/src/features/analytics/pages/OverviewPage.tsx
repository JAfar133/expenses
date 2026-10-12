import { useSearchParams } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { formatAmount, formatMoney } from '../../../shared/utils/money.ts';
import { CategoryChart } from '../components/CategoryChart.tsx';
import { CategoryNames } from '../components/CategoryNames.tsx';
import { DailyChart } from '../components/DailyChart.tsx';
import { StatTile } from '../components/StatTile.tsx';
import { useAnalyticsReference } from '../hooks/useAnalyticsReference.ts';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { scaleBreakdown, scaleSeries, scaleSummary } from '../model/currency.ts';
import { useBreakdown, useSummary, useTimeseries } from '../hooks/useAnalytics.ts';
import { useFilterState } from '../hooks/useFilterState.ts';
import { changePercent } from '../model/chart-data.ts';
import { pickDrillCategory } from '../model/drill.ts';
import { granularityFor, toApiFilters } from '../model/filter-state.ts';

/** Overview of the selected period with all filters applied: metrics, dynamics over time and categories. */
export default function OverviewPage() {
  const { state, today } = useFilterState();
  const filters = toApiFilters(state, today);
  const granularity = granularityFor(state, today);
  const { categoryOrder } = useAnalyticsReference();
  const { code: currency, factor, digits } = useDisplayCurrency();

  const summary = useSummary(filters);
  const series = useTimeseries(filters, granularity);
  const categories = useBreakdown(filters, 'category');

  // The category for the name breakdown is kept in the URL (`?drill=...`)
  const [params, setParams] = useSearchParams();
  const drill = pickDrillCategory(params.get('drill'), categories.data ?? []);
  const names = useBreakdown({ ...filters, categories: drill ? [drill] : [] }, 'name', {
    enabled: drill !== undefined,
  });
  const selectCategory = (category: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('drill', category);
        return next;
      },
      { replace: true },
    );

  // Amounts are in drams in the database; converted to the selected currency on display
  const scaled = summary.data && scaleSummary(summary.data, factor, digits);
  const current = scaled?.current;
  const previous = scaled?.previous ?? undefined;
  const money = (value: number | undefined) =>
    value === undefined ? '…' : `${formatAmount(value, digits)} ${currency}`;
  const note = current ? `к предыдущим ${current.days} дн.` : undefined;

  return (
    <div className="space-y-4">
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
          className="col-span-2 lg:col-span-1"
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

      <DailyChart
        points={series.data && scaleSeries(series.data, factor, digits)}
        currency={currency}
        granularity={granularity}
        loading={series.isPending}
      />
      <CategoryChart
        rows={categories.data && scaleBreakdown(categories.data, factor, digits)}
        currency={currency}
        categoryOrder={categoryOrder}
        onSelect={selectCategory}
        loading={categories.isPending}
      />
      <CategoryNames
        categories={scaleBreakdown(categories.data ?? [], factor, digits)}
        selected={drill}
        onSelect={selectCategory}
        names={drill ? names.data && scaleBreakdown(names.data, factor, digits) : []}
        categoryOrder={categoryOrder}
        currency={currency}
        loading={names.isPending && drill !== undefined}
      />
    </div>
  );
}
