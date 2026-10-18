import type { AppNotification } from '../api/notifications.api.ts';

export type DayGroup = 'Сегодня' | 'Вчера' | 'Ранее';

const dayStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** «Сегодня», «Вчера» or «Ранее» by the local calendar day. */
export function dayGroupOf(iso: string, now = new Date()): DayGroup {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Ранее';
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  return days <= 0 ? 'Сегодня' : days === 1 ? 'Вчера' : 'Ранее';
}

/** The feed split into the groups that have rows, in the order of the day; the order inside a group is kept. */
export function groupByDay(
  items: AppNotification[],
  now = new Date(),
): { title: DayGroup; items: AppNotification[] }[] {
  const order: DayGroup[] = ['Сегодня', 'Вчера', 'Ранее'];
  return order
    .map((title) => ({
      title,
      items: items.filter((item) => dayGroupOf(item.createdAt, now) === title),
    }))
    .filter((group) => group.items.length > 0);
}

export type FeedFilter = 'all' | 'unread' | 'errors';

export const matchesFilter = (item: AppNotification, filter: FeedFilter) =>
  filter === 'all' || (filter === 'unread' ? !item.read : item.type === 'import_problem');
