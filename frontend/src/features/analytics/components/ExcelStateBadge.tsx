import type { ExcelState } from '../api/operations.api.ts';
import { describeQueued, EXCEL_STATES } from '../model/operations.ts';

interface ExcelStateBadgeProps {
  state: ExcelState;
  /** Delay reason code (e.g. FILE_LOCKED) */
  error: string | null;
  /** Excel is disabled on the server: nothing to reconcile with */
  excelEnabled: boolean;
}

/**
 * A small chip only for what needs attention: the record waits in the queue for Excel (add, update, remove) or the
 * write was delayed with a reason. A matching record, a disabled Excel and the plain «deleted» states show nothing.
 */
export function ExcelStateBadge({ state, error, excelEnabled }: ExcelStateBadgeProps) {
  if (!excelEnabled) return null;
  const info = EXCEL_STATES[state];
  if (info.tone !== 'queued') return null;
  const reason = describeQueued(state, error);

  return (
    <span className="mt-0.5 flex flex-col gap-0.5">
      <span
        title={info.hint}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <span aria-hidden="true">⏳</span>
        {info.label}
      </span>
      {reason && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Причина: {reason}</span>
      )}
    </span>
  );
}
