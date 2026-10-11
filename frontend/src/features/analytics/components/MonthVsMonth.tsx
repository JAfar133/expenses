import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../../../shared/utils/money.ts';
import type { BreakdownRow } from '../api/analytics.api.ts';
import { compareCategories, type CategoryDifference } from '../model/compare.ts';
import { monthLabel, type MonthKey } from '../model/periods.ts';
import { ChartCard, ChartMessage } from './ChartCard.tsx';
import { ChartTooltip } from './ChartTooltip.tsx';
import { Change } from './MonthsTable.tsx';

const COLOR_A = 'var(--series-1)';
const COLOR_B = 'var(--series-2)';
const MAX_CHART_ROWS = 8;
const ROW_HEIGHT = 52;
const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };

const selectClass =
  'h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900';

interface MonthVsMonthProps {
  months: MonthKey[];
  a: MonthKey;
  b: MonthKey;
  onChange: (months: { a: MonthKey; b: MonthKey }) => void;
  rowsA: BreakdownRow[] | undefined;
  rowsB: BreakdownRow[] | undefined;
  currency: string;
  loading?: boolean;
}

/** Два месяца рядом: куда уходит больше или меньше денег, чем в другом месяце. */
export function MonthVsMonth({
  months,
  a,
  b,
  onChange,
  rowsA,
  rowsB,
  currency,
  loading = false,
}: MonthVsMonthProps) {
  const differences = rowsA && rowsB ? compareCategories(rowsA, rowsB) : undefined;
  const totalA = rowsA?.reduce((sum, row) => sum + row.total, 0) ?? 0;
  const totalB = rowsB?.reduce((sum, row) => sum + row.total, 0) ?? 0;
  const chartRows = differences?.slice(0, MAX_CHART_ROWS) ?? [];

  const picker = (label: string, value: MonthKey, onPick: (month: MonthKey) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className={selectClass}
        value={value}
        onChange={(event) => onPick(event.target.value)}
      >
        {[...months].reverse().map((month) => (
          <option key={month} value={month}>
            {monthLabel(month)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <ChartCard
      title="Месяц к месяцу"
      description="Где расходы выросли или снизились по сравнению с другим месяцем"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {picker('Первый месяц', a, (month) => onChange({ a: month, b }))}
          <span className="text-sm text-zinc-500 dark:text-zinc-400">к</span>
          {picker('Второй месяц', b, (month) => onChange({ a, b: month }))}
        </div>
      }
    >
      {loading && !differences ? (
        <ChartMessage>Загрузка…</ChartMessage>
      ) : !differences || differences.length === 0 ? (
        <ChartMessage>В этих месяцах расходов нет</ChartMessage>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <strong className="font-semibold">{monthLabel(a)}</strong>: {formatMoney(totalA)}{' '}
            {currency}
            {' · '}
            <strong className="font-semibold">{monthLabel(b)}</strong>: {formatMoney(totalB)}{' '}
            {currency}
            {totalB > 0 && (
              <>
                {' · '}
                <Change value={((totalA - totalB) / totalB) * 100} />
              </>
            )}
          </p>

          <div
            style={{ height: chartRows.length * ROW_HEIGHT + 24 }}
            role="img"
            aria-label="Сравнение категорий двух месяцев"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                layout="vertical"
                barGap={2}
                margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="key"
                  width={104}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.5 }}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as CategoryDifference | undefined;
                    if (!active || !row) return null;
                    return (
                      <ChartTooltip
                        title={row.key}
                        rows={[
                          {
                            label: monthLabel(a),
                            value: `${formatMoney(row.a)} ${currency}`,
                            color: COLOR_A,
                          },
                          {
                            label: monthLabel(b),
                            value: `${formatMoney(row.b)} ${currency}`,
                            color: COLOR_B,
                          },
                        ]}
                      />
                    );
                  }}
                />
                <Bar
                  dataKey="a"
                  fill={COLOR_A}
                  maxBarSize={16}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="b"
                  fill={COLOR_B}
                  maxBarSize={16}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Месяцы">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-3 rounded-sm"
                style={{ background: COLOR_A }}
              />
              {monthLabel(a)}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-3 rounded-sm"
                style={{ background: COLOR_B }}
              />
              {monthLabel(b)}
            </li>
          </ul>

          <div className="overflow-x-auto">
            <table
              aria-label="Сравнение категорий двух месяцев"
              className="w-full min-w-[30rem] border-collapse text-left text-sm"
            >
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  <th scope="col" className="py-2 font-medium">
                    Категория
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {monthLabel(a)}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {monthLabel(b)}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Разница, {currency}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {differences.map((row) => (
                  <tr key={row.key} className="border-b border-zinc-100 dark:border-zinc-800">
                    <th scope="row" className="py-2 font-normal">
                      {row.key}
                    </th>
                    <td className="py-2 text-right tabular-nums">{formatMoney(row.a)}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(row.b)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {row.difference > 0 ? '+' : ''}
                      {formatMoney(row.difference)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <Change value={row.change} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
