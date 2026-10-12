import { useSearchParams } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { CategoryByMonthChart } from '../components/CategoryByMonthChart.tsx';
import { ChartTypeSwitch } from '../components/ChartTypeSwitch.tsx';
import { MonthlyTotalsChart } from '../components/MonthlyTotalsChart.tsx';
import { MonthsTable } from '../components/MonthsTable.tsx';
import { MonthVsMonth } from '../components/MonthVsMonth.tsx';
import { useAnalyticsReference } from '../hooks/useAnalyticsReference.ts';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { scaleBreakdown, scaleSeries } from '../model/currency.ts';
import { useBreakdown, useTimeseries } from '../hooks/useAnalytics.ts';
import { useFilterState } from '../hooks/useFilterState.ts';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { PREFERENCES } from '../../preferences/model/preferences.ts';
import { toCategoryMatrix, toMonthRows } from '../model/compare.ts';
import { toApiFilters } from '../model/filter-state.ts';
import {
  isMonthKey,
  monthOf,
  monthRange,
  monthsEndingAt,
  shiftMonth,
  type MonthKey,
} from '../model/periods.ts';

/** Month from the URL if it is in the shown range; otherwise the default. */
const monthParam = (value: string | null, months: MonthKey[], fallback: MonthKey): MonthKey =>
  isMonthKey(value) && months.includes(value) ? value : fallback;

/** Month comparison: dynamics, categories by month, a table and "month vs month". The period is its own, other filters are shared. */
export default function ComparePage() {
  const { state, today } = useFilterState();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = usePreference('compare.months');
  const { categoryOrder } = useAnalyticsReference();
  const { code: currency, factor, digits } = useDisplayCurrency();

  const latest = monthOf(today);
  const months = monthsEndingAt(latest, Number(range));
  const filters = {
    ...toApiFilters(state, today, false),
    from: monthRange(months[0]!).from,
    to: monthRange(latest).to,
  };

  const totals = useTimeseries(filters, 'month');
  const byCategory = useTimeseries(filters, 'month', 'category');

  const a = monthParam(params.get('a'), months, latest);
  const b = monthParam(
    params.get('b'),
    months,
    shiftMonth(latest, -1) >= months[0]! ? shiftMonth(latest, -1) : latest,
  );
  const rowsA = useBreakdown(
    { ...toApiFilters(state, today, false), ...monthRange(a) },
    'category',
  );
  const rowsB = useBreakdown(
    { ...toApiFilters(state, today, false), ...monthRange(b) },
    'category',
  );

  const monthRows = totals.data
    ? toMonthRows(scaleSeries(totals.data, factor, digits), today)
    : undefined;
  const matrix = byCategory.data
    ? toCategoryMatrix(scaleSeries(byCategory.data, factor, digits), months)
    : undefined;

  const pickMonths = (next: { a: MonthKey; b: MonthKey }) =>
    setParams(
      (current) => {
        const merged = new URLSearchParams(current);
        merged.set('a', next.a);
        merged.set('b', next.b);
        return merged;
      },
      { replace: true },
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Сравнение по месяцам</h2>
        <ChartTypeSwitch
          label="За сколько месяцев"
          options={PREFERENCES['compare.months'].options}
          mobileColumns={3}
          value={range}
          onChange={setRange}
        />
      </div>

      {totals.isError && (
        <Notice variant="error">
          Не удалось загрузить данные.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => void totals.refetch()}
          >
            Повторить
          </button>
        </Notice>
      )}

      <MonthlyTotalsChart rows={monthRows} currency={currency} loading={totals.isPending} />
      <CategoryByMonthChart
        matrix={matrix}
        categoryOrder={categoryOrder}
        currency={currency}
        loading={byCategory.isPending}
      />
      <MonthsTable rows={monthRows} currency={currency} />
      <MonthVsMonth
        months={months}
        a={a}
        b={b}
        onChange={pickMonths}
        rowsA={rowsA.data && scaleBreakdown(rowsA.data, factor, digits)}
        rowsB={rowsB.data && scaleBreakdown(rowsB.data, factor, digits)}
        currency={currency}
        loading={rowsA.isPending || rowsB.isPending}
      />
    </div>
  );
}
