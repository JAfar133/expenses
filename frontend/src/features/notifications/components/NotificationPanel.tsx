import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { BellIcon } from '../../../shared/ui/icons.tsx';
import type { AppNotification } from '../api/notifications.api.ts';
import { useAutoRead } from '../hooks/useAutoRead.ts';
import { useMarkRead, useNotificationFeed, type useDismiss } from '../hooks/useNotifications.ts';
import { groupByDay, matchesFilter, type FeedFilter } from '../model/groups.ts';
import { NotificationDetails } from './NotificationDetails.tsx';
import { NotificationRow } from './NotificationRow.tsx';

const EMPTY: Record<FeedFilter, { title: string; hint: string }> = {
  all: {
    title: 'Пока уведомлений нет',
    hint: 'Здесь появятся новые расходы из банка, ошибки импорта и распознанные чеки',
  },
  unread: {
    title: 'У вас нет непрочитанных уведомлений',
    hint: 'Мы сообщим вам, когда появятся новые уведомления',
  },
  errors: {
    title: 'Ошибок нет',
    hint: 'Если запрос из банка не создаст расход, он появится здесь',
  },
};

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition ' +
        (active
          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-700'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70 dark:bg-zinc-800 dark:text-zinc-300')
      }
    >
      {children}
    </button>
  );
}

const Count = ({ n }: { n: number }) =>
  n > 0 ? (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
      {n}
    </span>
  ) : null;

/**
 * The content of the bell panel: filter chips, the feed in groups «Сегодня / Вчера / Ранее», «Показать ещё», and the
 * empty, loading and error states; an import problem opens its details instead of the list.
 */
export function NotificationPanel({
  onClose,
  onHidden,
  details,
  onDetails,
  dismiss,
}: {
  onClose: () => void;
  /** Something was hidden: the ids for the «Вернуть» of the toast */
  onHidden: (ids: string[]) => void;
  /** The import problem whose details are open, if any */
  details: AppNotification | null;
  onDetails: (item: AppNotification | null) => void;
  dismiss: ReturnType<typeof useDismiss>;
}) {
  const feed = useNotificationFeed();
  const markRead = useMarkRead();
  const list = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = items.filter((item) => matchesFilter(item, filter));
  const unreadCount = items.filter((item) => !item.read).length;
  const errors = items.filter((item) => item.type === 'import_problem');
  const unreadErrors = errors.filter((item) => !item.read).length;

  // Rows that are really seen (also those that arrive through the live stream) turn read by themselves
  useAutoRead(list, details ? [] : shown, (ids) => markRead.mutate(ids));

  const hide = (ids?: string[]) =>
    dismiss.mutate(ids, { onSuccess: (result) => result.ids.length > 0 && onHidden(result.ids) });

  const go = (link: string) => {
    onClose();
    void navigate(link);
  };

  const open = (item: AppNotification) => {
    if (!item.read) markRead.mutate([item.id]);
    // An announcement unfolds in its own row; a problem opens its details; the rest open their page
    if (item.type === 'announcement') return;
    if (item.type === 'import_problem') return onDetails(item);
    if (item.link) go(item.link);
  };

  if (details) {
    return (
      <NotificationDetails item={details} onClose={() => onDetails(null)} onOpenExpense={go} />
    );
  }

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Фильтр"
        // The padding leaves room for the focus ring and the red dot: a scrolling box clips whatever sticks out of it
        className="-mx-1.5 -mt-1 flex gap-2 overflow-x-auto px-1.5 pb-1.5 pt-1.5"
      >
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          Все
        </Chip>
        <Chip active={filter === 'unread'} onClick={() => setFilter('unread')}>
          Непрочитанные <Count n={unreadCount} />
        </Chip>
        <Chip active={filter === 'errors'} onClick={() => setFilter('errors')}>
          Ошибки
          {unreadErrors > 0 && (
            <span
              aria-label="есть непрочитанные ошибки"
              className="size-1.5 rounded-full bg-red-600"
            />
          )}
          <Count n={errors.length} />
        </Chip>
      </div>

      {feed.isPending && (
        <div role="status" aria-label="Загрузка" className="space-y-3 py-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="flex animate-pulse gap-3 px-2">
              <div className="size-10 rounded-xl bg-zinc-200 dark:bg-zinc-700" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-4/5 rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {feed.isError && (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Не удалось загрузить</p>
          <button
            type="button"
            onClick={() => void feed.refetch()}
            className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Повторить
          </button>
        </div>
      )}

      {feed.isSuccess && shown.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-950 dark:text-indigo-300 [&>svg]:size-8">
            <BellIcon />
          </span>
          <p className="text-base font-semibold">{EMPTY[filter].title}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{EMPTY[filter].hint}</p>
        </div>
      )}

      {dismiss.isError && <Notice variant="error">Не удалось скрыть уведомление</Notice>}

      <div ref={list} className="space-y-3">
        {groupByDay(shown).map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h4 className="px-1 pb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {group.title}
            </h4>
            <ul aria-label={group.title}>
              {group.items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onOpen={open}
                  onHide={(target) => hide([target.id])}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {feed.hasNextPage && (
        <button
          type="button"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
          className="h-11 w-full rounded-xl border border-zinc-200 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
