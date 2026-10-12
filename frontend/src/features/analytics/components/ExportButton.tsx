import { DownloadIcon } from '../../../shared/ui/icons.tsx';

/** Icon button "Скачать Excel": busy (disabled, pulsing) while the file is being prepared. */
export function ExportButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Скачать Excel"
      title="Скачать Excel с текущими фильтрами"
      aria-busy={busy}
      disabled={busy}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-indigo-600 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 sm:size-9 dark:border-zinc-700 dark:text-indigo-300"
    >
      <span className={busy ? 'animate-pulse' : undefined}>
        <DownloadIcon />
      </span>
    </button>
  );
}
