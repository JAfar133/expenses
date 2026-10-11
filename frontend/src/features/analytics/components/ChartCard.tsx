import type { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  description?: string;
  /** Переключатели вида, справа от заголовка */
  actions?: ReactNode;
  children: ReactNode;
  /** Те же данные таблицей: точные цифры и доступность для скринридера */
  table?: ReactNode;
}

/** Рамка графика: заголовок, переключатели, сам график и раскрывающаяся таблица с данными. */
export function ChartCard({ title, description, actions, children, table }: ChartCardProps) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {actions}
      </div>

      {children}

      {table && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none text-indigo-600 dark:text-indigo-400">
            Данные таблицей
          </summary>
          <div className="mt-2 max-h-72 overflow-auto">{table}</div>
        </details>
      )}
    </section>
  );
}

/** Состояние графика без данных или с ошибкой. */
export function ChartMessage({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-h-40 items-center justify-center text-center text-sm text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}

/** Таблица данных графика: просто, с выравниванием чисел по правому краю. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {columns.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={`py-1.5 font-medium ${index > 0 ? 'text-right' : ''}`}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b border-zinc-100 dark:border-zinc-800">
            {row.map((cell, index) => (
              <td key={index} className={`py-1.5 ${index > 0 ? 'text-right tabular-nums' : ''}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
