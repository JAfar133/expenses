import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../../../shared/api/http.ts';
import { CheckIcon, CopyIcon, RefreshIcon, WarningIcon } from '../../../shared/ui/icons.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { copyText } from '../../../shared/utils/clipboard.ts';
import { sourceLabel } from '../../integrations/model/format.ts';
import { formatDateTime } from '../../group/model/format.ts';
import type { AppNotification } from '../api/notifications.api.ts';
import { useImportLogEntry, useRetryImport } from '../hooks/useImportLogEntry.ts';
import { relativeTime } from '../model/time.ts';

const GONE = 'Запись больше недоступна: журнал хранится 30 дней';
const LABEL = 'text-xs font-semibold text-zinc-500 dark:text-zinc-400';

const cut = (value: unknown) => {
  const line = typeof value === 'string' ? value : JSON.stringify(value);
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

/** The first lines of what came: title, body and source, each cut short. */
export function previewOf(raw: Record<string, unknown>): string {
  const keys = ['title', 'body', 'source'].filter((key) => key in raw);
  const lines = keys.map((key) => `${key}: ${JSON.stringify(cut(raw[key]))}`);
  if (Object.keys(raw).length > keys.length) lines.push('...');
  return lines.join('\n');
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? 'Скопировано' : label}
      title={copied ? 'Скопировано' : label}
      onClick={async () => setCopied(await copyText(value))}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5">
    <div className={LABEL}>{label}</div>
    <div className="text-sm break-words">{children}</div>
  </div>
);

/** The details of an import problem inside the panel: where it came from, why it failed, the data, and a retry. */
export function NotificationDetails({
  item,
  onClose,
  onOpenExpense,
}: {
  item: AppNotification;
  /** «Закрыть»: back to the list */
  onClose: () => void;
  /** «Открыть операцию» after a successful retry */
  onOpenExpense: (link: string) => void;
}) {
  const importId = typeof item.data?.importId === 'string' ? item.data.importId : null;
  const entry = useImportLogEntry(importId);
  const retry = useRetryImport();
  const [result, setResult] = useState<'ok' | { failed: string } | null>(null);

  const source = String(item.data?.sourceLabel ?? sourceLabel(String(item.data?.source ?? '')));
  const reason =
    typeof item.data?.reason === 'string' && item.data.reason
      ? item.data.reason
      : (entry.data?.error ?? item.body);

  // Whatever went wrong with loading, the person is told the same: the record is not there any more
  const goneError = entry.isError;

  const run = () => {
    if (!importId) return;
    setResult(null);
    retry.mutate(importId, {
      onSuccess: (outcome) => {
        if (outcome.status === 'created' || outcome.status === 'duplicate') setResult('ok');
        else setResult({ failed: outcome.message ?? 'Запрос снова не удалось обработать' });
      },
    });
  };

  const retryError =
    retry.error instanceof ApiError
      ? retry.error.message
      : retry.isError
        ? 'Не удалось повторить обработку'
        : null;
  const transactionId = retry.data?.transactionId;
  const date = entry.data?.parsed?.localDate;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border-l-2 border-amber-400 bg-amber-50/60 p-3 dark:border-amber-500 dark:bg-amber-950/30">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
          <WarningIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{item.title}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {relativeTime(item.createdAt)}
          </div>
        </div>
        {!item.read && (
          <span
            role="img"
            aria-label="Не прочитано"
            className="size-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400"
          />
        )}
      </div>

      <Field label="Источник">{source}</Field>
      <Field label="Причина">{reason}</Field>

      {entry.isPending && importId && (
        <div role="status" aria-label="Загрузка" className="space-y-3">
          <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        </div>
      )}
      {goneError && <Notice variant="info">{GONE}</Notice>}

      {entry.data && (
        <>
          <Field label="Время получения">{formatDateTime(entry.data.receivedAt)}</Field>
          <Field label="Ключ">{entry.data.keyName ?? '—'}</Field>
          <div className="space-y-1.5">
            <div className={LABEL}>Полученные данные</div>
            <div className="flex items-start gap-1 rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-800">
              <pre
                aria-label="Полученные данные"
                className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap"
              >
                {previewOf(entry.data.rawPayload)}
              </pre>
              <CopyButton value={previewOf(entry.data.rawPayload)} label="Копировать данные" />
            </div>
            <details className="rounded-xl bg-zinc-100 dark:bg-zinc-800">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
                Полные данные (JSON)
              </summary>
              <div className="flex items-start gap-1 px-2.5 pb-2.5">
                <pre
                  aria-label="JSON запроса"
                  className="max-h-60 min-w-0 flex-1 overflow-auto font-mono text-xs break-all whitespace-pre-wrap"
                >
                  {JSON.stringify(entry.data.rawPayload, null, 2)}
                </pre>
                <CopyButton
                  value={JSON.stringify(entry.data.rawPayload, null, 2)}
                  label="Копировать JSON"
                />
              </div>
            </details>
          </div>
        </>
      )}

      {result === 'ok' && (
        <Notice variant="success">
          <span className="font-medium">Расход добавлен</span>
          {transactionId && (
            <>
              {' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() =>
                  onOpenExpense(
                    `/analytics/operations?expense=${transactionId}${date ? `&date=${date}` : ''}`,
                  )
                }
              >
                Открыть операцию
              </button>
            </>
          )}
        </Notice>
      )}
      {result !== null && result !== 'ok' && <Notice variant="info">{result.failed}</Notice>}
      {retryError && <Notice variant="error">{retryError}</Notice>}

      <div className="space-y-2">
        {entry.data?.retryable && result !== 'ok' && (
          <button
            type="button"
            disabled={retry.isPending}
            onClick={run}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-70"
          >
            <span className={retry.isPending ? 'animate-spin' : ''}>
              <RefreshIcon />
            </span>
            Повторить обработку
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-12 w-full rounded-xl bg-indigo-50 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
