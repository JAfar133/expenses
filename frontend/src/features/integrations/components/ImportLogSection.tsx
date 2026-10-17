import { useState } from 'react';
import { RefreshIcon } from '../../../shared/ui/icons.tsx';
import { useImportLog } from '../hooks/useIntegrations.ts';
import { ImportLogRow } from './ImportLogRow.tsx';

const FILTERS = [
  { value: '', label: 'Все' },
  { value: 'idbank', label: 'IDBank' },
  { value: 'apple_wallet', label: 'Apple Wallet' },
] as const;

/** «Журнал запросов»: everything that reached the import endpoint and what was done with it. Collapsed. */
export function ImportLogSection() {
  const [source, setSource] = useState('');
  const query = useImportLog(source || undefined);
  const entries = Array.isArray(query.data) ? query.data : [];

  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium">
        Журнал запросов
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {entries.length}
        </span>
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Что пришло на сервер и что с этим сделано. Хранится 30 дней
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            <RefreshIcon />
            Обновить
          </button>
        </div>
        <div
          role="radiogroup"
          aria-label="Источник"
          className="grid grid-cols-3 gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-800"
        >
          {FILTERS.map((filter) => {
            const active = filter.value === source;
            return (
              <button
                key={filter.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSource(filter.value)}
                className={
                  'min-h-11 rounded-xl px-2 text-sm transition ' +
                  (active
                    ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100')
                }
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        {entries.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Пока ничего не приходило</p>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {entries.map((entry) => (
            <ImportLogRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </div>
    </details>
  );
}
