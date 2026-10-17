const pad = (value: number) => String(value).padStart(2, '0');
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const dayStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** «только что», «5 мин назад», «сегодня, 20:41», «вчера, 20:41», «15 окт., 20:41» (with the year when it is not this one). */
export function relativeTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `сегодня, ${clock(date)}`;
  if (days === 1) return `вчера, ${clock(date)}`;
  const day = new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
  return `${day}, ${clock(date)}`;
}

/** «99+» above 99; empty when there is nothing unread. */
export const badgeText = (unread: number): string =>
  unread <= 0 ? '' : unread > 99 ? '99+' : String(unread);
