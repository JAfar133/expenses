import { Link, useNavigate } from 'react-router';
import type { AppNotification } from '../api/notifications.api.ts';
import { useMarkRead, useNotificationFeed } from '../hooks/useNotifications.ts';
import { NotificationRow } from './NotificationRow.tsx';

/** The content of the bell panel: «Прочитать все», the list, «Показать ещё» and the empty, loading and error states. */
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const feed = useNotificationFeed();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = feed.data?.pages[0]?.unread ?? 0;

  const open = (item: AppNotification) => {
    if (!item.read) markRead.mutate([item.id]);
    if (item.link) {
      onClose();
      void navigate(item.link);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          disabled={unread === 0 || markRead.isPending}
          onClick={() => markRead.mutate(undefined)}
          className="h-9 rounded-lg px-3 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          Прочитать все
        </button>
      </div>

      {feed.isPending && (
        <div role="status" aria-label="Загрузка" className="space-y-3 py-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="flex animate-pulse gap-3 px-2">
              <div className="size-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
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

      {feed.isSuccess && items.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Пока уведомлений нет. Здесь появятся новые расходы из банка, ошибки импорта и распознанные
          чеки
        </p>
      )}

      {items.length > 0 && (
        <ul aria-label="Уведомления" className="space-y-0.5">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} onOpen={open} />
          ))}
        </ul>
      )}

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
      <Link
        to="/settings#notifications"
        onClick={onClose}
        className="flex h-11 items-center justify-center text-sm font-medium text-indigo-600 dark:text-indigo-300"
      >
        Настроить уведомления
      </Link>
    </div>
  );
}
