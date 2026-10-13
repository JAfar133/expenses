import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { formatAmount, formatMoney } from '../../../shared/utils/money.ts';
import type { BreakdownRow } from '../api/analytics.api.ts';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { PREFERENCES } from '../../preferences/model/preferences.ts';
import { assignColors, seriesColor, toSlices, type Slice } from '../model/chart-data.ts';
import { pluralCategories } from '../../budgets/model/plural.ts';
import { BudgetsTab } from '../../budgets/components/BudgetsTab.tsx';
import { useBudgets } from '../../budgets/hooks/useBudgets.ts';
import { ChartCard, ChartMessage, DataTable } from './ChartCard.tsx';
import { ChartTooltip } from './ChartTooltip.tsx';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';

const SERIES_COLOR = 'var(--series-1)';
const ROW_HEIGHT = 38;
const axisTick = { fill: 'var(--chart-axis)', fontSize: 12 };

interface CategoryChartProps {
  rows: BreakdownRow[] | undefined;
  currency: string;
  /** Category order from the reference data: colors are pinned by it */
  categoryOrder: string[];
  /** Clicking a category (bar, slice or legend row) opens its names */
  onSelect?: (category: string) => void;
  loading?: boolean;
}

const TABS = [
  { value: 'limits', label: 'Бюджет и лимиты' },
  { value: 'structure', label: 'Структура расходов' },
] as const;

/**
 * Which categories take the most money. With limits the card has two tabs, «Бюджет и лимиты» and
 * «Структура расходов» (the choice is remembered); without limits it is just the structure.
 */
export function CategoryChart({
  rows,
  currency,
  categoryOrder,
  onSelect,
  loading = false,
}: CategoryChartProps) {
  const [type, setType] = usePreference('category.type');
  const [tab, setTab] = usePreference('category.tab');
  const { digits } = useDisplayCurrency();
  const budgets = useBudgets(currency).data;
  const hasLimits = !!budgets && budgets.length > 0;
  const showLimits = hasLimits && tab === 'limits';
  const total = rows?.reduce((sum, row) => sum + row.total, 0) ?? 0;
  const slices = toSlices(rows ?? []);

  const viewSwitch = (
    <ChartTypeSwitch
      label="Вид графика"
      options={PREFERENCES['category.type'].options}
      mobileColumns={3}
      value={type}
      onChange={setType}
    />
  );

  return (
    <ChartCard
      title="Расход по категориям"
      // Without limits there are no tabs: the view switch stays in the header
      actions={!hasLimits && viewSwitch}
      table={
        !showLimits &&
        rows &&
        total > 0 && (
          <DataTable
            columns={['Категория', `Сумма, ${currency}`, 'Доля', 'Операций']}
            rows={rows.map((row) => [
              row.key,
              formatMoney(row.total),
              `${formatMoney((row.total / total) * 100, 1)}%`,
              row.count,
            ])}
          />
        )
      }
    >
      {/* Tabs always come first; the view switch is under them and only on the structure tab */}
      {hasLimits && (
        <div className="mb-4 space-y-3">
          <ChartTypeSwitch
            label="Раздел"
            options={TABS}
            value={tab}
            onChange={setTab}
            mobileColumns={2}
          />
          {!showLimits && viewSwitch}
        </div>
      )}
      {showLimits ? (
        <BudgetsTab budgets={budgets} rows={rows} onSelect={onSelect} />
      ) : loading && !rows ? (
        <ChartMessage>Загрузка…</ChartMessage>
      ) : !rows || total === 0 ? (
        <ChartMessage>За выбранный период расходов нет</ChartMessage>
      ) : (
        <>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Всего расходов{' '}
            <strong className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {formatAmount(total, digits)} {currency}
            </strong>
          </p>
          {type === 'bars' ? (
            <BarsChart rows={rows} currency={currency} onSelect={onSelect} />
          ) : (
            <ShareChart
              slices={slices}
              total={total}
              currency={currency}
              categoryOrder={categoryOrder}
              donut={type === 'donut'}
              onSelect={onSelect}
            />
          )}
        </>
      )}
    </ChartCard>
  );
}

function BarsChart({
  rows,
  currency,
  onSelect,
}: {
  rows: BreakdownRow[];
  currency: string;
  onSelect?: (category: string) => void;
}) {
  const { digits } = useDisplayCurrency();
  /** Bar click: Recharts passes the data row either directly or in `payload`. */
  const select = (entry: unknown) => {
    const { key, payload } = entry as { key?: string; payload?: { key?: string } };
    const category = payload?.key ?? key;
    if (category) onSelect?.(category);
  };
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.5 }}
      content={({ active, payload }) => {
        const row = payload?.[0]?.payload as BreakdownRow | undefined;
        if (!active || !row) return null;
        return (
          <ChartTooltip
            title={row.key}
            rows={[
              {
                label: 'Потрачено',
                value: `${formatMoney(row.total)} ${currency}`,
                color: SERIES_COLOR,
              },
              { label: 'Операций', value: String(row.count) },
              { label: 'Средний чек', value: `${formatAmount(row.average, digits)} ${currency}` },
            ]}
          />
        );
      }}
    />
  );

  return (
    <div
      style={{ height: Math.max(160, rows.length * ROW_HEIGHT + 16) }}
      role="img"
      aria-label="Категории по сумме расходов"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="key"
            width={104}
            tick={{ ...axisTick, fill: 'var(--chart-axis)' }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          {tooltip}
          <Bar
            dataKey="total"
            fill={SERIES_COLOR}
            maxBarSize={24}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            className={onSelect ? 'cursor-pointer' : undefined}
            onClick={select}
          >
            <LabelList
              dataKey="total"
              position="right"
              formatter={(value: unknown) => formatMoney(Number(value))}
              style={{ fill: 'var(--chart-axis)', fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Shares: donut or pie. Up to 7 slices, small categories are merged into "Other"; a legend with shares and amounts sits beside it. */
function ShareChart({
  slices,
  total,
  currency,
  categoryOrder,
  donut,
  onSelect,
}: {
  slices: Slice[];
  total: number;
  currency: string;
  categoryOrder: string[];
  donut: boolean;
  onSelect?: (category: string) => void;
}) {
  const colors = assignColors(
    slices.filter((slice) => !slice.isOther).map((slice) => slice.key),
    categoryOrder,
  );
  const colorOf = (slice: Slice) => seriesColor(slice.isOther ? null : colors.get(slice.key));

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
      <div
        className="relative h-56 w-full max-w-64 shrink-0"
        role="img"
        aria-label="Доли категорий в расходах"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              // Tooltip above the donut center label, otherwise the label shows through it
              wrapperStyle={{ zIndex: 20 }}
              content={({ active, payload }) => {
                const slice = payload?.[0]?.payload as Slice | undefined;
                if (!active || !slice) return null;
                return (
                  <ChartTooltip
                    title={slice.key}
                    rows={[
                      {
                        label: 'Потрачено',
                        value: `${formatMoney(slice.total)} ${currency}`,
                        color: colorOf(slice),
                      },
                      { label: 'Доля', value: `${formatMoney(slice.share * 100, 1)}%` },
                      { label: 'Операций', value: String(slice.count) },
                      ...(slice.isOther
                        ? [{ label: 'Объединено категорий', value: String(slice.merged) }]
                        : []),
                    ]}
                  />
                );
              }}
            />
            <Pie
              data={slices}
              dataKey="total"
              nameKey="key"
              innerRadius={donut ? '62%' : 0}
              outerRadius="92%"
              paddingAngle={slices.length > 1 ? 2 : 0}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell
                  key={slice.key}
                  fill={colorOf(slice)}
                  className={onSelect && !slice.isOther ? 'cursor-pointer' : undefined}
                  onClick={() => !slice.isOther && onSelect?.(slice.key)}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {donut && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Всего</span>
            <span className="text-lg font-semibold">{formatMoney(total)}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{currency}</span>
          </div>
        )}
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {slices.map((slice) => {
          const row = (
            <>
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-sm"
                style={{ background: colorOf(slice) }}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {slice.key}
                {slice.isOther && (
                  <span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {slice.merged} {pluralCategories(slice.merged)}
                  </span>
                )}
              </span>
              <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatMoney(slice.share * 100, 0)}%
              </span>
              <span className="w-24 text-right font-medium tabular-nums">
                {formatMoney(slice.total)}
              </span>
            </>
          );
          const rowClass = 'flex w-full items-center gap-2 rounded-md px-1 py-0.5';
          return (
            <li key={slice.key}>
              {onSelect && !slice.isOther ? (
                <button
                  type="button"
                  onClick={() => onSelect(slice.key)}
                  aria-label={`${slice.key}: показать наименования`}
                  className={`${rowClass} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
                >
                  {row}
                </button>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
