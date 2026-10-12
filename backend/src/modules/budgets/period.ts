import { addDays } from '../analytics/date-math.ts';

export type BudgetPeriodKind = 'month' | 'month_from_day' | 'week';

export interface BudgetPeriod {
  /** First day of the period (YYYY-MM-DD), inclusive */
  from: string;
  /** Last day of the period, inclusive */
  to: string;
}

const pad = (value: number) => String(value).padStart(2, '0');
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The same day number in the month `shift` months from `iso`'s month (the day is at most 28, so it always exists). */
function monthDay(iso: string, day: number, shift: number): string {
  const [year, month] = iso.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + shift;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-${pad(day)}`;
}

/**
 * The period of a limit that contains `today`:
 * the calendar month, a month that starts on a given day, or the week from Monday to Sunday.
 */
export function periodOf(kind: BudgetPeriodKind, day: number | null, today: string): BudgetPeriod {
  if (kind === 'week') {
    const weekday = (new Date(toUtc(today)).getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(today, -weekday);
    return { from, to: addDays(from, 6) };
  }

  const startDay = kind === 'month_from_day' && day ? day : 1;
  const thisStart = monthDay(today, startDay, 0);
  const from = today >= thisStart ? thisStart : monthDay(today, startDay, -1);
  const nextStart = monthDay(from, startDay, 1);
  return { from, to: addDays(nextStart, -1) };
}
