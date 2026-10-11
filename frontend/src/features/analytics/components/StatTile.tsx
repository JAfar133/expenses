import { formatMoney } from '../../../shared/utils/money.ts';

interface StatTileProps {
  label: string;
  value: string;
  /** Change versus the previous period, %; null or unset: not shown */
  change?: number | null;
  /** Name of the comparison period, e.g. "vs 1-15 September" */
  changeNote?: string;
  /** Extra layout classes (e.g. span two columns) */
  className?: string;
}

/**
 * Metric tile: label, value and (optionally) change versus the previous period.
 * For expenses growth is bad and a decrease is good; direction is always duplicated by an arrow and text, not only color.
 */
export function StatTile({
  label,
  value,
  change,
  changeNote = 'к прошлому периоду',
  className = '',
}: StatTileProps) {
  const rounded = change === null || change === undefined ? null : Math.round(change);
  const direction = rounded === null || rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down';

  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900 ${className}`}>
      <div className="text-sm text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 whitespace-nowrap text-xl font-semibold tracking-tight sm:text-2xl">
        {value}
      </div>
      {rounded !== null && (
        <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span
            aria-hidden="true"
            style={{
              color:
                direction === 'up'
                  ? 'var(--chart-critical)'
                  : direction === 'down'
                    ? 'var(--chart-good)'
                    : undefined,
            }}
          >
            {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '•'}
          </span>
          <span>
            {direction === 'up'
              ? 'больше на'
              : direction === 'down'
                ? 'меньше на'
                : 'без изменений'}
            {direction !== 'flat' && ` ${formatMoney(Math.abs(rounded), 0)}%`} {changeNote}
          </span>
        </div>
      )}
    </div>
  );
}
