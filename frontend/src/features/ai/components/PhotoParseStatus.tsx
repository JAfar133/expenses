import { formatMoney } from '../../../shared/utils/money.ts';
import type { PhotoParseState } from '../hooks/usePhotoParse.ts';

/** Next to the photo: a spinner while the AI reads the receipt, a soft message with «Повторить» on a failure. */
export function PhotoParseStatus({
  state,
  onRetry,
  receiptTotal,
}: {
  state: PhotoParseState;
  onRetry: () => void;
  /** The total on the receipt, when it differs noticeably from what was typed */
  receiptTotal?: { total: number; currency: string | null };
}) {
  if (state.status === 'running') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300"
      >
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600"
        />
        ИИ читает чек…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <span className="min-w-0 flex-1">{state.message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="h-9 shrink-0 rounded-lg border border-amber-300 px-3 text-sm font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900"
        >
          Повторить
        </button>
      </div>
    );
  }
  if (receiptTotal) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        На чеке итог {formatMoney(receiptTotal.total)} {receiptTotal.currency ?? ''}
      </p>
    );
  }
  return null;
}
