import type { PeriodKind } from '../api/budgets.api.ts';

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));

/** Period of a limit containing `today` (YYYY-MM-DD), by the same rules as the server. */
export function periodFor(
  kind: PeriodKind,
  day: number | null,
  today: string,
): { from: string; to: string } {
  const [year, month, dayOfMonth] = today.split('-').map(Number) as [number, number, number];
  if (kind === 'week') {
    const date = utc(year, month - 1, dayOfMonth);
    const sinceMonday = (date.getUTCDay() + 6) % 7;
    return {
      from: iso(utc(year, month - 1, dayOfMonth - sinceMonday)),
      to: iso(utc(year, month - 1, dayOfMonth - sinceMonday + 6)),
    };
  }
  if (kind === 'month' || !day || day <= 1) {
    return { from: iso(utc(year, month - 1, 1)), to: iso(utc(year, month, 0)) };
  }
  // Month starting on `day`: the one that contains today
  const startMonth = dayOfMonth >= day ? month - 1 : month - 2;
  return {
    from: iso(utc(year, startMonth, day)),
    to: iso(utc(year, startMonth + 1, day - 1)),
  };
}

/** «05.10 – 04.11» */
export function periodText(period: { from: string; to: string }): string {
  const short = (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}`;
  return `${short(period.from)} – ${short(period.to)}`;
}

/** Period words for a row: «месяц», «месяц с 5-го», «неделя». */
export function periodWords(kind: PeriodKind, day: number | null): string {
  if (kind === 'week') return 'неделя';
  return kind === 'month_from_day' ? `месяц с ${day}-го` : 'месяц';
}
