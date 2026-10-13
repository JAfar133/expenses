import { useState } from 'react';
import { inputClassName } from '../../../shared/ui/Field.tsx';
import { SelectBox, selectPadding } from '../../../shared/ui/SelectBox.tsx';
import { formatMoney } from '../../../shared/utils/money.ts';
import type { BreakdownRow } from '../api/analytics.api.ts';
import { assignColors, seriesColor } from '../model/chart-data.ts';
import { toNameShares } from '../model/drill.ts';
import { ChartCard, ChartMessage } from './ChartCard.tsx';

/** How many names to show at once; the rest expand with a button. */
const VISIBLE_NAMES = 10;

interface CategoryNamesProps {
  /** Categories of the period, biggest spend first */
  categories: BreakdownRow[];
  selected: string | undefined;
  onSelect: (category: string) => void;
  /** Names in the selected category, biggest spend first; undefined while loading */
  names: BreakdownRow[] | undefined;
  categoryOrder: string[];
  currency: string;
  loading?: boolean;
}

/** Which names take the most spend within the selected category. */
export function CategoryNames({
  categories,
  selected,
  onSelect,
  names,
  categoryOrder,
  currency,
  loading = false,
}: CategoryNamesProps) {
  const [expanded, setExpanded] = useState(false);

  const category = categories.find((row) => row.key === selected);
  const colors = assignColors(
    categories.map((row) => row.key),
    categoryOrder,
  );
  const color = seriesColor(selected ? colors.get(selected) : undefined);

  const shares = category && names ? toNameShares(names, category.total) : [];
  const shown = expanded ? shares : shares.slice(0, VISIBLE_NAMES);

  return (
    <ChartCard
      title="Наименования в категории"
      description="Выберите категорию или нажмите на неё в диаграмме выше"
    >
      {categories.length === 0 ? (
        <ChartMessage>За выбранный период расходов нет</ChartMessage>
      ) : (
        <div className="space-y-4">
          <SelectBox>
            <select
              aria-label="Категория"
              value={selected ?? ''}
              onChange={(event) => {
                setExpanded(false);
                onSelect(event.target.value);
              }}
              className={`${inputClassName} ${selectPadding}`}
            >
              {categories.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.key}
                </option>
              ))}
            </select>
          </SelectBox>

          {category && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                {category.key}
              </strong>
              : {formatMoney(category.total)} {currency}, операций: {category.count}
            </p>
          )}

          {loading && !names ? (
            <ChartMessage>Загрузка…</ChartMessage>
          ) : shares.length === 0 ? (
            <ChartMessage>В этой категории нет расходов</ChartMessage>
          ) : (
            <>
              <ul className="space-y-2" aria-label={`Наименования в категории ${selected}`}>
                {shown.map((row) => (
                  <li
                    key={row.key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
                  >
                    <span className="truncate" title={row.key}>
                      {row.key}
                    </span>
                    <span
                      aria-hidden="true"
                      className="order-last col-span-2 h-5 sm:order-none sm:col-span-1"
                    >
                      <span
                        className="block h-full rounded-r"
                        style={{ width: `${Math.max(row.relative * 100, 1)}%`, background: color }}
                      />
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{formatMoney(row.total)}</span>
                      <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                        {formatMoney(row.share * 100, 0)}% · {row.count}×
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              {shares.length > VISIBLE_NAMES && (
                <button
                  type="button"
                  onClick={() => setExpanded((current) => !current)}
                  className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {expanded ? 'Свернуть' : `Показать все (${shares.length})`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </ChartCard>
  );
}
