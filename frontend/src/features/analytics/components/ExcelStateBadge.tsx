import type { ExcelState } from '../api/operations.api.ts';
import { describeQueued, EXCEL_STATES } from '../model/operations.ts';

const TONE_STYLES = {
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  queued: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  gone: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
} as const;

/** State badge next to the form: the symbol duplicates the color so the meaning does not depend on it alone. */
const TONE_ICON = { ok: '✓', queued: '⏳', gone: '–' } as const;

interface ExcelStateBadgeProps {
  state: ExcelState;
  /** Delay reason code (e.g. FILE_LOCKED) */
  error: string | null;
  /** Excel is disabled on the server: nothing to reconcile with */
  excelEnabled: boolean;
}

/** Whether the record matches Excel and whether sync went through; for queued records, also why. */
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
