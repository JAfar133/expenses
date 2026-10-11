import type { ExcelState } from '../api/operations.api.ts';
import { describeQueued, EXCEL_STATES } from '../model/operations.ts';

const TONE_STYLES = {
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  queued: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  gone: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
} as const;

/** Значок состояния рядом с формой: символ дублирует цвет, чтобы смысл не зависел только от него. */
const TONE_ICON = { ok: '✓', queued: '⏳', gone: '–' } as const;

interface ExcelStateBadgeProps {
  state: ExcelState;
  /** Код причины задержки (например, FILE_LOCKED) */
  error: string | null;
  /** Excel отключён на сервере: сверять не с чем */
  excelEnabled: boolean;
}

/** Совпадает ли запись с Excel и дошла ли синхронизация; для записей в очереди ещё и почему. */
export function ExcelStateBadge({ state, error, excelEnabled }: ExcelStateBadgeProps) {
  if (!excelEnabled) {
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${TONE_STYLES.gone}`}>
        Excel отключён
      </span>
    );
  }

  const info = EXCEL_STATES[state];
  const reason = describeQueued(state, error);

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        title={info.hint}
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_STYLES[info.tone]}`}
      >
        <span aria-hidden="true">{TONE_ICON[info.tone]}</span>
        {info.label}
      </span>
      {reason && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Причина: {reason}</span>
      )}
    </span>
  );
}
