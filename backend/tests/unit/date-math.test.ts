import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInclusive,
  nextPeriod,
  periodStart,
  todayIn,
} from '../../src/modules/analytics/date-math.ts';

describe('date-math', () => {
  it('addDays переходит через границы месяца и года', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('daysInclusive считает оба конца и не уходит в минус', () => {
    expect(daysInclusive('2026-10-01', '2026-10-15')).toBe(15);
    expect(daysInclusive('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysInclusive('2026-10-02', '2026-10-01')).toBe(0);
  });

  it('periodStart: день, понедельник недели, первое число месяца', () => {
    expect(periodStart('2026-10-15', 'day')).toBe('2026-10-15');
    // 1 октября 2026 четверг, неделя начинается 28 сентября; воскресенье относится к прошедшей неделе
    expect(periodStart('2026-10-01', 'week')).toBe('2026-09-28');
    expect(periodStart('2026-10-04', 'week')).toBe('2026-09-28');
    expect(periodStart('2026-10-05', 'week')).toBe('2026-10-05');
    expect(periodStart('2026-10-15', 'month')).toBe('2026-10-01');
  });

  it('nextPeriod: следующий день, неделя, месяц (в том числе через конец года)', () => {
    expect(nextPeriod('2026-10-31', 'day')).toBe('2026-11-01');
    expect(nextPeriod('2026-10-26', 'week')).toBe('2026-11-02');
    expect(nextPeriod('2026-10-01', 'month')).toBe('2026-11-01');
    expect(nextPeriod('2026-12-01', 'month')).toBe('2027-01-01');
  });

  it('todayIn берёт дату в нужном часовом поясе', () => {
    const instant = new Date('2026-10-14T21:30:00Z');

    expect(todayIn('UTC', instant)).toBe('2026-10-14');
    expect(todayIn('Asia/Yerevan', instant)).toBe('2026-10-15');
  });
});
