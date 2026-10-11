import { formatMoney } from '../../../shared/utils/money.ts';

interface StatTileProps {
  label: string;
  value: string;
  /** Изменение к предыдущему периоду, %; null или не задано: не показываем */
  change?: number | null;
  /** Название периода сравнения, например «к 1–15 сентября» */
  changeNote?: string;
}

/**
 * Плитка показателя: подпись, значение и (необязательно) изменение к предыдущему периоду.
 * Для расходов рост это плохо, а снижение хорошо; направление всегда дублируется стрелкой и текстом, а не только цветом.
 */
export function StatTile({
  label,
  value,
  change,
  changeNote = 'к прошлому периоду',
}: StatTileProps) {
  const rounded = change === null || change === undefined ? null : Math.round(change);
  const direction = rounded === null || rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down';

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
      <div className="text-sm text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
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
