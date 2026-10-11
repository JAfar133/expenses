import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../../shared/utils/money.ts';
import { compactNumber } from '../model/chart-data.ts';
import { averageOfCompleteMonths, type MonthRow } from '../model/compare.ts';
import { monthLabel, monthYearShortLabel } from '../model/periods.ts';
import { ChartCard, ChartMessage, DataTable } from './ChartCard.tsx';
import { ChartTooltip } from './ChartTooltip.tsx';

const SERIES_COLOR = 'var(--series-1)';
const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };

interface MonthlyTotalsChartProps {
  rows: MonthRow[] | undefined;
  currency: string;
  loading?: boolean;
}

/** Расходы по месяцам: столбики и линия среднего по завершённым месяцам. Текущий (неполный) месяц светлее. */
export function MonthlyTotalsChart({ rows, currency, loading = false }: MonthlyTotalsChartProps) {
  const hasSpending = rows?.some((row) => row.total > 0) ?? false;
  const average = rows ? averageOfCompleteMonths(rows) : null;

  return (
    <ChartCard
      title="Расходы по месяцам"
      description={
        average === null
          ? undefined
          : `Среднее по завершённым месяцам: ${formatMoney(Math.round(average))} ${currency}`
      }
      table={
        rows &&
        hasSpending && (
          <DataTable
            columns={['Месяц', `Сумма, ${currency}`, 'Операций']}
            rows={rows.map((row) => [monthLabel(row.month), formatMoney(row.total), row.count])}
          />
        )
      }
    >
      {loading && !rows ? (
        <ChartMessage>Загрузка…</ChartMessage>
      ) : !rows || !hasSpending ? (
        <ChartMessage>За выбранные месяцы расходов нет</ChartMessage>
      ) : (
        <div style={{ height: 260 }} role="img" aria-label="Расходы по месяцам">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows.map((row) => ({ ...row, label: monthYearShortLabel(row.month) }))}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                width={44}
                tickFormatter={compactNumber}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              {average !== null && (
                <ReferenceLine y={average} stroke="var(--chart-axis)" strokeDasharray="4 4" />
              )}
              <Tooltip
                cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.5 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as MonthRow | undefined;
                  if (!active || !row) return null;
                  return (
                    <ChartTooltip
                      title={monthLabel(row.month) + (row.partial ? ' (не закончился)' : '')}
                      rows={[
                        {
                          label: 'Потрачено',
                          value: `${formatMoney(row.total)} ${currency}`,
                          color: SERIES_COLOR,
                        },
                        { label: 'Операций', value: String(row.count) },
                        {
                          label: 'В день',
                          value: `${formatMoney(Math.round(row.perDay))} ${currency}`,
                        },
                        ...(row.change === null
                          ? []
                          : [
                              {
                                label: 'К предыдущему месяцу',
                                value: `${row.change > 0 ? '▲ +' : row.change < 0 ? '▼ ' : ''}${formatMoney(Math.round(row.change))}%`,
                              },
                            ]),
                      ]}
                    />
                  );
                }}
              />
              <Bar
                dataKey="total"
                fill={SERIES_COLOR}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell key={row.month} fillOpacity={row.partial ? 0.5 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
