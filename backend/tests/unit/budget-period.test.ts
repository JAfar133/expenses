import { describe, expect, it } from 'vitest';
import { periodOf } from '../../src/modules/budgets/period.ts';

describe('календарный месяц', () => {
  it.each([
    ['2026-10-12', '2026-10-01', '2026-10-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-29', '2028-02-01', '2028-02-29'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
  ])('%s -> %s … %s', (today, from, to) => {
    expect(periodOf('month', null, today)).toEqual({ from, to });
  });
});

describe('месяц с выбранного числа', () => {
  it('сегодня уже после числа начала: период начался в этом месяце', () => {
    expect(periodOf('month_from_day', 5, '2026-10-12')).toEqual({
      from: '2026-10-05',
      to: '2026-11-04',
    });
  });

  it('сегодня ровно число начала: начинается сегодня', () => {
    expect(periodOf('month_from_day', 5, '2026-10-05')).toEqual({
      from: '2026-10-05',
      to: '2026-11-04',
    });
  });

  it('сегодня раньше числа начала: период начался в прошлом месяце', () => {
    expect(periodOf('month_from_day', 5, '2026-10-03')).toEqual({
      from: '2026-09-05',
      to: '2026-10-04',
    });
  });

  it('через границу года', () => {
    expect(periodOf('month_from_day', 15, '2026-01-10')).toEqual({
      from: '2025-12-15',
      to: '2026-01-14',
    });
    expect(periodOf('month_from_day', 15, '2026-12-20')).toEqual({
      from: '2026-12-15',
      to: '2027-01-14',
    });
  });

  it('число 28 есть в любом месяце, включая февраль', () => {
    expect(periodOf('month_from_day', 28, '2026-03-02')).toEqual({
      from: '2026-02-28',
      to: '2026-03-27',
    });
  });

  it('число 1 это календарный месяц', () => {
    expect(periodOf('month_from_day', 1, '2026-10-12')).toEqual(
      periodOf('month', null, '2026-10-12'),
    );
  });
});

describe('неделя', () => {
  it.each([
    ['2026-10-12', '2026-10-12', '2026-10-18'], // Monday
    ['2026-10-15', '2026-10-12', '2026-10-18'],
    ['2026-10-18', '2026-10-12', '2026-10-18'], // Sunday
    ['2026-10-19', '2026-10-19', '2026-10-25'],
  ])('%s -> %s … %s', (today, from, to) => {
    expect(periodOf('week', null, today)).toEqual({ from, to });
  });
});
