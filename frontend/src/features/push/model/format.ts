/** «17 окт.» (with the year when it is not this one) for the list of devices. */
export function shortDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
    .format(date)
    .replace(/\s?г\.$/, '');
}
