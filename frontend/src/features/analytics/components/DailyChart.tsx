import {
  Area,
  AreaChart,
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
import type { Granularity, SeriesPoint } from '../api/analytics.api.ts';
import { usePersistentChoice } from '../hooks/usePersistentChoice.ts';
import { compactNumber, cumulative } from '../model/chart-data.ts';
import {
  dayLabel,
  dayOfMonth,
  monthLabel,
  monthOf,
  monthYearShortLabel,
  shortDayLabel,
} from '../model/periods.ts';
import { ChartCard, ChartMessage, DataTable } from './ChartCard.tsx';
import { ChartTooltip } from './ChartTooltip.tsx';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';

const TYPES = ['bars', 'line', 'area'] as const;
type DailyType = (typeof TYPES)[number];
const MODES = ['daily', 'cumulative'] as const;
type DailyMode = (typeof MODES)[number];

const TYPE_OPTIONS = [
  { value: 'bars', label: 'Столбики' },
  { value: 'line', label: 'Линия' },
  { value: 'area', label: 'Область' },
] satisfies { value: DailyType; label: string }[];

const MODE_OPTIONS = [
  { value: 'daily', label: 'За день' },
  { value: 'cumulative', label: 'Накопительно' },
] satisfies { value: DailyMode; label: string }[];

const SERIES_COLOR = 'var(--series-1)';
const CHART_HEIGHT = 240;

const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };

/** Подписи по шагу графика: по дням, неделям или месяцам. */
const STEP = {
  day: { title: 'Расходы по дням', tick: dayOfMonth, full: dayLabel },
  week: {
    title: 'Расходы по неделям',
    tick: shortDayLabel,
    full: (period: string) => `Неделя с ${shortDayLabel(period)}`,
  },
  month: {
    title: 'Расходы по месяцам',
    tick: (period: string) => monthYearShortLabel(monthOf(period)),
    full: (period: string) => monthLabel(monthOf(period)),
  },
} satisfies Record<
  Granularity,
  { title: string; tick: (p: string) => string; full: (p: string) => string }
>;

interface DailyChartProps {
  points: SeriesPoint[] | undefined;
  /** Шаг графика; по умолчанию дни */
  granularity?: Granularity;
  currency: string;
  loading?: boolean;
}

/** Расходы по дням: столбики, линия или область; за день или нарастающим итогом. Вид запоминается. */
export function DailyChart({
  points,
  currency,
  granularity = 'day',
  loading = false,
}: DailyChartProps) {
  const step = STEP[granularity];
  const [type, setType] = usePersistentChoice<DailyType>('daily.type', TYPES, 'bars');
  const [mode, setMode] = usePersistentChoice<DailyMode>('daily.mode', MODES, 'daily');

  const data = points && mode === 'cumulative' ? cumulative(points) : points;
  const hasSpending = points?.some((point) => point.total > 0) ?? false;

  return (
    <ChartCard
      title={step.title}
      description={mode === 'cumulative' ? 'Нарастающим итогом с начала периода' : undefined}
      actions={
        <div className="flex flex-wrap gap-2">
          <ChartTypeSwitch
            label="Что показывать"
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
          />
          <ChartTypeSwitch
            label="Вид графика"
            options={TYPE_OPTIONS}
            value={type}
            onChange={setType}
          />
        </div>
      }
      table={
        points &&
        hasSpending && (
          <DataTable
            columns={[
              granularity === 'day' ? 'День' : granularity === 'week' ? 'Неделя' : 'Месяц',
              `Сумма, ${currency}`,
              'Операций',
            ]}
            rows={(data ?? []).map((p) => [step.full(p.period), formatMoney(p.total), p.count])}
          />
        )
      }
    >
      {loading && !data ? (
        <ChartMessage>Загрузка…</ChartMessage>
      ) : !data || !hasSpending ? (
        <ChartMessage>За выбранный период расходов нет</ChartMessage>
      ) : (
        <div style={{ height: CHART_HEIGHT }} role="img" aria-label={step.title}>
          <ResponsiveContainer width="100%" height="100%">
            {renderChart(type, data, currency, step)}
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function renderChart(
  type: DailyType,
  data: SeriesPoint[],
  currency: string,
  step: (typeof STEP)[Granularity],
) {
  const margin = { top: 8, right: 8, bottom: 0, left: 0 };
  const common = { data, margin };

  const grid = <CartesianGrid vertical={false} stroke="var(--chart-grid)" />;
  const xAxis = (
    <XAxis
      dataKey="period"
      tickFormatter={step.tick}
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: 'var(--chart-grid)' }}
      interval="preserveStartEnd"
      minTickGap={10}
    />
  );
  const yAxis = (
    <YAxis
      width={44}
      tickFormatter={compactNumber}
      tick={axisTick}
      tickLine={false}
      axisLine={false}
    />
  );
  const tooltip = (cursor: object) => (
    <Tooltip
      cursor={cursor}
      content={({ active, payload }) => {
        const point = payload?.[0]?.payload as SeriesPoint | undefined;
        if (!active || !point) return null;
        return (
          <ChartTooltip
            title={step.full(point.period)}
            rows={[
              {
                label: 'Потрачено',
                value: `${formatMoney(point.total)} ${currency}`,
                color: SERIES_COLOR,
              },
              { label: 'Операций', value: String(point.count) },
            ]}
          />
        );
      }}
    />
  );

  if (type === 'line') {
    return (
      <LineChart {...common}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip({ stroke: 'var(--chart-axis)' })}
        <Line
          type="monotone"
          dataKey="total"
          stroke={SERIES_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 4, fill: SERIES_COLOR, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    );
  }

  if (type === 'area') {
    return (
      <AreaChart {...common}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip({ stroke: 'var(--chart-axis)' })}
        <Area
          type="monotone"
          dataKey="total"
          stroke={SERIES_COLOR}
          strokeWidth={2}
          fill={SERIES_COLOR}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, fill: SERIES_COLOR, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    );
  }

  return (
    <BarChart {...common}>
      {grid}
      {xAxis}
      {yAxis}
      {tooltip({ fill: 'var(--chart-grid)', fillOpacity: 0.5 })}
      <Bar
        dataKey="total"
        fill={SERIES_COLOR}
        maxBarSize={24}
        radius={[4, 4, 0, 0]}
        isAnimationActive={false}
      />
    </BarChart>
  );
}
