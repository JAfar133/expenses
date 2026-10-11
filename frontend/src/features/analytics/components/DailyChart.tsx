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
import { PREFERENCES, type PreferenceValue } from '../../preferences/model/preferences.ts';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
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
  const [type, setType] = usePreference('daily.type');
  const [mode, setMode] = usePreference('daily.mode');

  const data = points && mode === 'cumulative' ? cumulative(points) : points;
  const hasSpending = points?.some((point) => point.total > 0) ?? false;

  return (
    <ChartCard
      title={step.title}
      description={mode === 'cumulative' ? 'Нарастающим итогом с начала периода' : undefined}
      actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <ChartTypeSwitch
            label="Что показывать"
            options={PREFERENCES['daily.mode'].options}
            mobileColumns={2}
            value={mode}
            onChange={setMode}
          />
          <ChartTypeSwitch
            label="Вид графика"
            options={PREFERENCES['daily.type'].options}
            mobileColumns={3}
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
  type: PreferenceValue<'daily.type'>,
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
