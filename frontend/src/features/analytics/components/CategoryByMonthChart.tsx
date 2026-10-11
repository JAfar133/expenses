import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../../shared/utils/money.ts';
import { usePersistentChoice } from '../hooks/usePersistentChoice.ts';
import { assignColors, compactNumber, OTHER_KEY, seriesColor } from '../model/chart-data.ts';
import type { CategoryMatrix } from '../model/compare.ts';
import { monthLabel, monthYearShortLabel } from '../model/periods.ts';
import { ChartCard, ChartMessage, DataTable } from './ChartCard.tsx';
import { ChartTooltip } from './ChartTooltip.tsx';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';

const TYPES = ['stacked', 'lines'] as const;
type MatrixType = (typeof TYPES)[number];

const TYPE_OPTIONS = [
  { value: 'stacked', label: 'С накоплением' },
  { value: 'lines', label: 'Линии' },
] satisfies { value: MatrixType; label: string }[];

const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };

interface CategoryByMonthChartProps {
  matrix: CategoryMatrix | undefined;
  categoryOrder: string[];
  currency: string;
  loading?: boolean;
}

/** Как меняются расходы по категориям от месяца к месяцу: столбики с накоплением или линии по категориям. */
export function CategoryByMonthChart({
  matrix,
  categoryOrder,
  currency,
  loading = false,
}: CategoryByMonthChartProps) {
  const [type, setType] = usePersistentChoice<MatrixType>('matrix.type', TYPES, 'stacked');
  const categories = matrix?.categories ?? [];
  const hasData = matrix?.rows.some((row) => Object.keys(row.values).length > 0) ?? false;

  const colors = assignColors(
    categories.filter((key) => key !== OTHER_KEY),
    categoryOrder,
  );
  const colorOf = (key: string) => seriesColor(key === OTHER_KEY ? null : colors.get(key));

  const data = (matrix?.rows ?? []).map((row) => ({
    month: row.month,
    label: monthYearShortLabel(row.month),
    ...Object.fromEntries(categories.map((key) => [key, row.values[key] ?? 0])),
  }));

  const tooltip = (
    <Tooltip
      cursor={
        type === 'lines'
          ? { stroke: 'var(--chart-axis)' }
          : { fill: 'var(--chart-grid)', fillOpacity: 0.5 }
      }
      content={({ active, payload }) => {
        const entry = payload?.[0]?.payload as
          ((typeof data)[number] & Record<string, number>) | undefined;
        if (!active || !entry) return null;
        const items = categories
          .map((key) => ({ key, value: entry[key] ?? 0 }))
          .filter((item) => item.value > 0)
          .sort((a, b) => b.value - a.value);
        const total = items.reduce((sum, item) => sum + item.value, 0);
        return (
          <ChartTooltip
            title={monthLabel(entry.month)}
            rows={[
              ...items.map((item) => ({
                label: item.key,
                value: `${formatMoney(item.value)} ${currency}`,
                color: colorOf(item.key),
              })),
              { label: 'Всего', value: `${formatMoney(total)} ${currency}` },
            ]}
          />
        );
      }}
    />
  );

  const axes = (
    <>
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
    </>
  );

  return (
    <ChartCard
      title="Категории по месяцам"
      description="Крупнейшие категории за весь выбранный период"
      actions={
        <ChartTypeSwitch
          label="Вид графика"
          options={TYPE_OPTIONS}
          mobileColumns={2}
          value={type}
          onChange={setType}
        />
      }
      table={
        matrix &&
        hasData && (
          <DataTable
            columns={['Месяц', ...categories]}
            rows={matrix.rows.map((row) => [
              monthLabel(row.month),
              ...categories.map((key) => formatMoney(row.values[key] ?? 0)),
            ])}
          />
        )
      }
    >
      {loading && !matrix ? (
        <ChartMessage>Загрузка…</ChartMessage>
      ) : !matrix || !hasData ? (
        <ChartMessage>За выбранные месяцы расходов нет</ChartMessage>
      ) : (
        <>
          <div style={{ height: 280 }} role="img" aria-label="Категории по месяцам">
            <ResponsiveContainer width="100%" height="100%">
              {type === 'lines' ? (
                <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  {axes}
                  {tooltip}
                  {categories.map((key) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={colorOf(key)}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={{
                        r: 4,
                        fill: colorOf(key),
                        stroke: 'var(--chart-surface)',
                        strokeWidth: 2,
                      }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  {axes}
                  {tooltip}
                  {categories.map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="months"
                      fill={colorOf(key)}
                      stroke="var(--chart-surface)"
                      strokeWidth={2}
                      maxBarSize={36}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Категории">
            {categories.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-sm"
                  style={{ background: colorOf(key) }}
                />
                {key}
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  );
}
