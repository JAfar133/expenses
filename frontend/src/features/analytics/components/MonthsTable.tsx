import { useState } from 'react';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { formatMoney, formatRounded } from '../../../shared/utils/money.ts';
import { sortRows, type MonthRow, type SortDirection } from '../model/compare.ts';
import { monthLabel } from '../model/periods.ts';
import { ChartCard, ChartMessage } from './ChartCard.tsx';

type Column = 'month' | 'total' | 'count' | 'perDay' | 'change';

const COLUMNS: { id: Column; label: string; numeric: boolean }[] = [
  { id: 'month', label: 'Месяц', numeric: false },
  { id: 'total', label: 'Потрачено', numeric: true },
  { id: 'count', label: 'Операций', numeric: true },
  { id: 'perDay', label: 'В день', numeric: true },
  { id: 'change', label: 'К пред. месяцу', numeric: true },
];

const valueOf = (row: MonthRow, column: Column): number | string | null =>
  column === 'month' ? row.month : row[column];

interface MonthsTableProps {
  rows: MonthRow[] | undefined;
  currency: string;
}

/** Table by month sortable by any column (newest months on top by default). */
export function MonthsTable({ rows, currency }: MonthsTableProps) {
  const { digits } = useDisplayCurrency();
  const [sort, setSort] = useState<{ column: Column; direction: SortDirection }>({
    column: 'month',
    direction: 'desc',
  });

  const toggle = (column: Column) =>
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: column === 'month' ? 'desc' : 'desc' },
    );

  const sorted = rows ? sortRows(rows, (row) => valueOf(row, sort.column), sort.direction) : [];

  return (
    <ChartCard title="По месяцам" description="Нажмите на заголовок столбца, чтобы отсортировать">
      {!rows || rows.length === 0 ? (
        <ChartMessage>Нет данных</ChartMessage>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label="Расходы по месяцам"
            className="w-full min-w-[32rem] border-collapse text-left text-sm"
          >
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {COLUMNS.map((column) => {
                  const active = sort.column === column.id;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={
                        active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      className={`py-2 font-medium ${column.numeric ? 'text-right' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(column.id)}
                        className="inline-flex items-center gap-1 rounded px-1 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        {column.label}
                        <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
                          {sort.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.month} className="border-b border-zinc-100 dark:border-zinc-800">
                  <th scope="row" className="py-2 font-normal">
                    {monthLabel(row.month)}
                    {row.partial && (
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        не закончился
                      </span>
                    )}
                  </th>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatMoney(row.total)} {currency}
                  </td>
                  <td className="py-2 text-right tabular-nums">{row.count}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatRounded(row.perDay, digits)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Change value={row.change} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

/** Percent change with an arrow: direction is visible without color. */
export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-400">—</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <span>0%</span>;
  return (
    <span>
      <span
        aria-hidden="true"
        style={{ color: rounded > 0 ? 'var(--chart-critical)' : 'var(--chart-good)' }}
      >
        {rounded > 0 ? '▲' : '▼'}
      </span>{' '}
      {rounded > 0 ? '+' : ''}
      {formatMoney(rounded, 0)}%
    </span>
  );
}
