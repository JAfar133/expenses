import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDownIcon, CheckIcon, CopyIcon, WarningIcon } from '../../../shared/ui/icons.tsx';
import { copyText } from '../../../shared/utils/clipboard.ts';
import type { ImportLogEntry } from '../api/integrations.api.ts';
import { logStatus, shortTime, sourceLabel, type Tone } from '../model/format.ts';

const TONES: Record<Tone, string> = {
  ok: 'text-green-700 dark:text-green-400',
  info: 'text-indigo-700 dark:text-indigo-300',
  muted: 'text-zinc-500 dark:text-zinc-400',
  warn: 'text-amber-800 dark:text-amber-300',
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function CopyJson({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}
      className={
        'flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-white transition ' +
        (state === 'copied' ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-500')
      }
    >
      {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
      {state === 'copied'
        ? 'Скопировано'
        : state === 'failed'
          ? 'Не удалось скопировать'
          : 'Копировать JSON'}
    </button>
  );
}

const Json = ({ value, label }: { value: unknown; label: string }) => (
  // Text only: the request is never rendered as HTML
  <pre
    aria-label={label}
    className="max-h-64 overflow-auto rounded-lg bg-zinc-50 p-2.5 font-mono text-xs break-all whitespace-pre-wrap dark:bg-zinc-950"
  >
    {pretty(value)}
  </pre>
);

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** «Что прочитал сервер» */
function ParsedList({ entry }: { entry: ImportLogEntry }) {
  const parsed = entry.parsed;
  if (!parsed || parsed.amount === undefined) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        Что прочитал сервер
      </h4>
      <dl className="space-y-1 text-sm">
        <Item label="Сумма">
          {parsed.amount} {parsed.currency}
        </Item>
        <Item label="Продавец">{parsed.merchant}</Item>
        <Item label="Время">{shortTime(parsed.occurredAt)}</Item>
        <Item label="Дата">{parsed.localDate}</Item>
        {parsed.cardLast4 && <Item label="Карта">•{parsed.cardLast4}</Item>}
        {parsed.cardHint && <Item label="Подсказка карты">{parsed.cardHint}</Item>}
        {parsed.categoryHint && <Item label="Подсказка категории">{parsed.categoryHint}</Item>}
        {parsed.transactionId && <Item label="Номер операции">{parsed.transactionId}</Item>}
      </dl>
    </div>
  );
}

/** One logged request: a summary line, expandable to the raw JSON, what the server read and how it matched. */
export function ImportLogRow({ entry }: { entry: ImportLogEntry }) {
  const [open, setOpen] = useState(false);
  const status = logStatus(entry);
  const parsed = entry.parsed;
  const device = entry.rawPayload?.device;
  const match = entry.match;

  return (
    <li
      data-tone={status.tone}
      className={
        'py-1 ' +
        (status.tone === 'warn' ? '-mx-2 rounded-lg bg-amber-50 px-2 dark:bg-amber-950/40' : '')
      }
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Скрыть' : 'Показать'} запрос: ${shortTime(entry.receivedAt)}, ${parsed?.merchant ?? 'без данных'}`}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-start gap-2 py-1.5 text-left text-sm"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium">{parsed?.merchant ?? '—'}</span>
            <span className="shrink-0 tabular-nums">
              {parsed && parsed.amount !== undefined
                ? `${parsed.amount} ${parsed.currency ?? ''}`.trim()
                : '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{shortTime(entry.receivedAt)}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {sourceLabel(entry.source)}
            </span>
            {entry.keyName && <span>{entry.keyName}</span>}
          </div>
          <div className={'flex items-start gap-1 text-xs font-medium ' + TONES[status.tone]}>
            {status.tone === 'warn' && (
              <span className="mt-px shrink-0 [&>svg]:size-3.5">
                <WarningIcon />
              </span>
            )}
            <span>{status.text}</span>
          </div>
          {status.detail && (
            <div className="text-xs text-zinc-600 dark:text-zinc-300">{status.detail}</div>
          )}
        </div>
        <span
          className={'mt-1 shrink-0 text-zinc-400 transition ' + (open ? 'rotate-180' : '')}
          aria-hidden="true"
        >
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div className="space-y-3 pb-3 text-sm">
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Запрос целиком
            </h4>
            <Json value={entry.rawPayload} label="JSON запроса" />
            <CopyJson text={pretty(entry.rawPayload)} />
          </div>
          {device !== undefined && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Устройство
              </h4>
              <Json value={device} label="Устройство" />
            </div>
          )}
          <ParsedList entry={entry} />
          {match && (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              {'mergedWalletEvents' in match
                ? `Объединены запросы Wallet: ${match.mergedWalletEvents.length}`
                : `Совпадение: ${
                    { merchant: 'по продавцу', card: 'по карте', 'same request': 'тот же запрос' }[
                      match.reason
                    ]
                  }, источник ${sourceLabel(match.source)}`}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
