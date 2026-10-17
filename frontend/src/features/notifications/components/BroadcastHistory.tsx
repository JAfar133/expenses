import { shortTime } from '../../integrations/model/format.ts';
import type { Broadcast } from '../api/broadcast.api.ts';
import { useBroadcasts } from '../hooks/useBroadcast.ts';
import { peopleLabel } from '../model/broadcast.ts';

const audienceText = (item: Broadcast) =>
  item.scope === 'group'
    ? 'всем в группе'
    : item.scope === 'all'
      ? 'всем пользователям'
      : peopleLabel(item.recipients);

/** «Отправленные»: the last messages of this person, collapsed. */
export function BroadcastHistory() {
  const { data } = useBroadcasts();
  const items = Array.isArray(data) ? data : [];

  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium">
        Отправленные
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {items.length}
        </span>
      </summary>
      <div className="px-3 pb-3">
        {items.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Вы ещё ничего не отправляли</p>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((item) => (
            <li key={item.id} className="space-y-0.5 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{item.title}</span>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {shortTime(item.createdAt)}
                </span>
              </div>
              <div className="line-clamp-2 text-zinc-600 dark:text-zinc-300">{item.body}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                кому: {audienceText(item)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
