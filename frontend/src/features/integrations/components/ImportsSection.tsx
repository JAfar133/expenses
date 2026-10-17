import { WarningIcon } from '../../../shared/ui/icons.tsx';
import { useImports } from '../hooks/useIntegrations.ts';
import { formatTime, statusOf } from '../model/format.ts';

const TONES = {
  ok: 'text-green-700 dark:text-green-400',
  muted: 'text-zinc-500 dark:text-zinc-400',
  warn: 'text-amber-800 dark:text-amber-300',
} as const;

/** «Последние импорты»: the last attempts of the phone, collapsed, with a count badge. */
export function ImportsSection() {
  const query = useImports();
  const imports = Array.isArray(query.data) ? query.data : [];

  return (
    <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium">
        Последние импорты
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {imports.length}
        </span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Что пришло с телефона и что с этим стало. Здесь видно, почему расход не добавился
        </p>
        {imports.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Пока ничего не приходило</p>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {imports.map((item) => {
            const status = statusOf(item.status, item.cardLast4);
            return (
              <li
                key={item.id}
                data-tone={status.tone}
                className={
                  'py-2.5 text-sm ' +
                  (status.tone === 'warn'
                    ? '-mx-2 rounded-lg bg-amber-50 px-2 dark:bg-amber-950/40'
                    : '')
                }
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{item.merchant ?? 'Без названия'}</span>
                  {item.amount !== null && (
                    <span className="shrink-0 tabular-nums">
                      {item.amount} {item.currency ?? ''}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {formatTime(item.createdAt)}
                  {item.cardLast4 && ` · •${item.cardLast4}`}
                </div>
                <div className={'flex items-start gap-1 text-xs font-medium ' + TONES[status.tone]}>
                  {status.tone === 'warn' && (
                    <span className="mt-px shrink-0 [&>svg]:size-3.5">
                      <WarningIcon />
                    </span>
                  )}
                  {status.text}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
