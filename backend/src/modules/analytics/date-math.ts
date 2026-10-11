const DAY_MS = 86_400_000;

const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) => toIso(toUtc(iso) + days * DAY_MS);

/** Сколько дней от `from` до `to` включительно (0, если `to` раньше `from`). */
export const daysInclusive = (from: string, to: string) =>
  Math.max(0, Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1);

/** Сегодняшняя дата в заданном часовом поясе (YYYY-MM-DD). */
export const todayIn = (timezone: string, now: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** Первый день периода для даты: сам день, понедельник недели или первое число месяца. */
export function periodStart(iso: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return iso;
  if (granularity === 'month') return `${iso.slice(0, 7)}-01`;
  const weekday = (new Date(toUtc(iso)).getUTCDay() + 6) % 7; // понедельник = 0
  return addDays(iso, -weekday);
}

/** Начало следующего периода. */
export function nextPeriod(start: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return addDays(start, 1);
  if (granularity === 'week') return addDays(start, 7);
  const [year, month] = start.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
