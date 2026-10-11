/** Month as `YYYY-MM`. All dates in the app have no time or time zone: `YYYY-MM-DD`. */
export type MonthKey = string;

const pad = (value: number) => String(value).padStart(2, '0');

export const monthOf = (isoDate: string): MonthKey => isoDate.slice(0, 7);

/** First and last day of a month. */
export function monthRange(month: MonthKey): { from: string; to: string } {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

/** Adjacent month: `shiftMonth('2026-01', -1)` → `2025-12`. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export const isMonthKey = (value: string | null): value is MonthKey =>
  value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', ...options });

const monthFormat = formatter({ month: 'long', year: 'numeric' });
const dayFormat = formatter({ weekday: 'long', day: 'numeric', month: 'long' });
const shortDayFormat = formatter({ day: 'numeric', month: 'short' });

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const atUtc = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** Month name with year, e.g. "October 2026" (Russian locale) */
export const monthLabel = (month: MonthKey) =>
  capitalize(monthFormat.format(atUtc(`${month}-01`)).replace(/\s*г\.$/, ''));

/** Weekday, day and month, e.g. "Saturday, 10 October" (Russian locale) */
export const dayLabel = (isoDate: string) => dayFormat.format(atUtc(isoDate));

/** Short day and month, e.g. "10 Oct." (Russian locale) */
export const shortDayLabel = (isoDate: string) => shortDayFormat.format(atUtc(isoDate));

/** Day of the month: `2026-10-05` → `5`. */
export const dayOfMonth = (isoDate: string) => String(Number(isoDate.slice(8, 10)));

const DAY_MS = 86_400_000;
const atUtcMs = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`);

/** Shift a date by a given number of days. */
export const addDays = (isoDate: string, days: number) =>
  new Date(atUtcMs(isoDate) + days * DAY_MS).toISOString().slice(0, 10);

/** Days from `from` to `to` inclusive (0 if `to` is earlier). */
export const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((atUtcMs(to) - atUtcMs(from)) / DAY_MS) + 1);

export const daysInMonth = (month: MonthKey) => {
  const { from, to } = monthRange(month);
  return daysBetween(from, to);
};

/** The last `count` months ending at `end`, from old to new. */
export const monthsEndingAt = (end: MonthKey, count: number): MonthKey[] =>
  Array.from({ length: count }, (_, index) => shiftMonth(end, index - (count - 1)));

const monthShortFormat = formatter({ month: 'short' });
const monthYearShortFormat = formatter({ month: 'short', year: '2-digit' });

/** Short month name, e.g. "Oct." (Russian locale) */
export const monthShortLabel = (month: MonthKey) =>
  monthShortFormat.format(atUtc(`${month}-01`)).replace('.', '');

/** Short month and year, e.g. "Oct 26" (Russian locale) */
export const monthYearShortLabel = (month: MonthKey) =>
  monthYearShortFormat
    .format(atUtc(`${month}-01`))
    .replace(/\./g, '')
    .replace(/\s*г$/, '');
