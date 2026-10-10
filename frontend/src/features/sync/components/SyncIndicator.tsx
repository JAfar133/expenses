import { useEffect } from 'react';
import type { SyncState } from '../api/sync.api.ts';
import { formatCountdown, useCountdown } from '../hooks/useCountdown.ts';
import { useRunSync, useSyncState } from '../hooks/useSyncState.ts';

type Tone = 'neutral' | 'warning' | 'error';

/** Сколько секунд значок остаётся красным после неудачного нажатия. */
const FAILED_VISIBLE_MS = 8000;

const TONE_STYLES: Record<Tone, string> = {
  neutral:
    'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  error:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
};

/**
 * Значок синхронизации с Excel: иконка и обратный отсчёт до следующего запуска.
 * Нажатие запускает синхронизацию сразу. Цвет показывает проблемы, число — очередь записи в Excel.
 */
export function SyncIndicator({
  failedVisibleMs = FAILED_VISIBLE_MS,
}: {
  failedVisibleMs?: number;
}) {
  const { data: state, dataUpdatedAt, isError } = useSyncState();
  const runSyncNow = useRunSync();

  // Неудачный ручной запуск — разовое событие: показываем его недолго, а не до перезагрузки страницы.
  // Состояние самой синхронизации (последний результат) при этом берётся с сервера и обновляется само.
  const { isError: startFailed, reset: clearStartFailure } = runSyncNow;
  useEffect(() => {
    if (!startFailed) return;
    const timer = setTimeout(clearStartFailure, failedVisibleMs);
    return () => clearTimeout(timer);
  }, [startFailed, clearStartFailure, failedVisibleMs]);

  if (!state) {
    return (
      <Pill
        tone={isError ? 'error' : 'neutral'}
        label={
          isError
            ? 'Не удалось получить состояние синхронизации'
            : 'Загрузка состояния синхронизации'
        }
        text={isError ? '!' : '…'}
        disabled
      />
    );
  }

  return (
    <LiveIndicator
      state={state}
      receivedAt={dataUpdatedAt}
      syncing={runSyncNow.isPending}
      failed={runSyncNow.isError}
      onSync={() => runSyncNow.mutate()}
    />
  );
}

interface LiveIndicatorProps {
  state: SyncState;
  receivedAt: number;
  syncing: boolean;
  failed: boolean;
  onSync: () => void;
}

function LiveIndicator({ state, receivedAt, syncing, failed, onSync }: LiveIndicatorProps) {
  const remaining = useCountdown(state.nextRunAt, state.serverTime, receivedAt);
  const busy = syncing || state.running;
  const timer = busy || remaining === null || remaining === 0 ? '…' : formatCountdown(remaining);

  return (
    <Pill
      tone={toneOf(state, failed)}
      label={describe(state, timer, busy, failed)}
      text={timer}
      spinning={busy}
      queued={state.queued}
      disabled={busy}
      onClick={onSync}
    />
  );
}

function toneOf(state: SyncState, failed: boolean): Tone {
  const status = state.lastResult?.status;
  if (failed || status === 'error') return 'error';
  if (state.queued > 0 || status === 'locked' || status === 'unavailable') return 'warning';
  return 'neutral';
}

/** Полное описание для screen reader и всплывающей подсказки: на значке места мало. */
function describe(state: SyncState, timer: string, busy: boolean, failed: boolean): string {
  const parts = ['Синхронизация с Excel'];

  parts.push(busy ? 'выполняется' : `следующая через ${timer}`);
  if (state.queued > 0) parts.push(`в очереди на запись: ${state.queued}`);
  if (failed) parts.push('не удалось запустить синхронизацию');
  if (state.lastResult?.error) parts.push(state.lastResult.error.message);
  if (!busy) parts.push('нажмите, чтобы синхронизировать сейчас');

  return parts.join('. ');
}

interface PillProps {
  tone: Tone;
  label: string;
  text: string;
  spinning?: boolean;
  queued?: number;
  disabled?: boolean;
  onClick?: () => void;
}

function Pill({ tone, label, text, spinning = false, queued = 0, disabled, onClick }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-tone={tone}
      className={
        'relative flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium shadow-sm ' +
        'transition active:scale-95 disabled:cursor-default disabled:active:scale-100 ' +
        TONE_STYLES[tone]
      }
    >
      <SyncIcon spinning={spinning} />
      <span className="min-w-[2.25rem] text-left tabular-nums">{text}</span>
      {queued > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white"
        >
          {queued}
        </span>
      )}
    </button>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-5 ${spinning ? 'animate-spin' : ''}`}
    >
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
