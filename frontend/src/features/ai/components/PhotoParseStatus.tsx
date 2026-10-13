import type { PhotoParseState } from '../hooks/usePhotoParse.ts';

/** Next to the photo: a spinner while the AI reads the receipt, a soft message with «Повторить» on a failure. */
export function PhotoParseStatus({
  state,
  onRetry,
}: {
  state: PhotoParseState;
  onRetry: () => void;
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
  return null;
}
