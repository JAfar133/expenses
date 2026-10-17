import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  PAGE_SIZE,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  type NotificationsPage,
} from '../api/notifications.api.ts';

/** Everything of the bell lives under one key: a single invalidation refreshes both the feed and the badge. */
export const NOTIFICATIONS_KEY = ['notifications'];
const UNREAD_KEY = [...NOTIFICATIONS_KEY, 'unread'];
const FEED_KEY = [...NOTIFICATIONS_KEY, 'feed'];

const POLL_MS = 60_000;

/**
 * The number on the bell. It polls once a minute while the tab is visible and refetches when the person comes back
 * to the tab; a failed poll is silent (the old number stays).
 */
export function useUnreadCount() {
  const query = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: fetchUnreadCount,
    refetchInterval: () => (document.hidden ? false : POLL_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const unread = query.data;
  // The number on the app icon, where the platform has it; a failure is silent
  useEffect(() => {
    if (unread === undefined) return;
    try {
      const nav = navigator as Navigator & {
        setAppBadge?: (count: number) => Promise<void>;
        clearAppBadge?: () => Promise<void>;
      };
      void (unread > 0 ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => undefined);
    } catch {
      // The badge is a convenience
    }
  }, [unread]);
  return query;
}

/** The feed, a page of 30 at a time; it is only read while the panel is open (it mounts with it). */
export function useNotificationFeed() {
  return useInfiniteQuery({
    queryKey: FEED_KEY,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.items.length >= PAGE_SIZE ? last.items[last.items.length - 1]?.createdAt : undefined,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

type Feed = InfiniteData<NotificationsPage, string | undefined>;
type Context = { feed?: Feed; unread?: number };

/** Marks some notifications (or all, without ids) read; the feed and the badge change at once, an error rolls back. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, string[] | undefined, Context>({
    retry: false,
    mutationFn: (ids) => markNotificationsRead(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const feed = queryClient.getQueryData<Feed>(FEED_KEY);
      const unread = queryClient.getQueryData<number>(UNREAD_KEY);
      let newlyRead = 0;
      if (feed) {
        const pages = feed.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => {
            if (item.read || (ids && !ids.includes(item.id))) return item;
            newlyRead += 1;
            return { ...item, read: true };
          }),
        }));
        // The number of unread in the pages follows the change too
        queryClient.setQueryData<Feed>(FEED_KEY, {
          ...feed,
          pages: pages.map((page) => ({
            ...page,
            unread: ids ? Math.max(0, page.unread - newlyRead) : 0,
          })),
        });
      }
      if (unread !== undefined) {
        queryClient.setQueryData<number>(UNREAD_KEY, ids ? Math.max(0, unread - newlyRead) : 0);
      }
      return { feed, unread };
    },
    onError: (_error, _ids, context) => {
      if (context?.feed) queryClient.setQueryData(FEED_KEY, context.feed);
      if (context?.unread !== undefined) queryClient.setQueryData(UNREAD_KEY, context.unread);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: UNREAD_KEY }),
  });
}
