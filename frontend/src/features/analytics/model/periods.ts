/** Месяц в виде `YYYY-MM`. Все даты в приложении без времени и часового пояса: `YYYY-MM-DD`. */
export type MonthKey = string;

const pad = (value: number) => String(value).padStart(2, '0');

export const monthOf = (isoDate: string): MonthKey => isoDate.slice(0, 7);

/** Первый и последний день месяца. */
export function monthRange(month: MonthKey): { from: string; to: string } {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

/** Соседний месяц: `shiftMonth('2026-01', -1)` → `2025-12`. */
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

/** «Октябрь 2026» */
export const monthLabel = (month: MonthKey) =>
  capitalize(monthFormat.format(atUtc(`${month}-01`)).replace(/\s*г\.$/, ''));

/** «суббота, 10 октября» */
export const dayLabel = (isoDate: string) => dayFormat.format(atUtc(isoDate));

/** «10 окт.» */
export const shortDayLabel = (isoDate: string) => shortDayFormat.format(atUtc(isoDate));

/** Число месяца: `2026-10-05` → `5`. */
export const dayOfMonth = (isoDate: string) => String(Number(isoDate.slice(8, 10)));
