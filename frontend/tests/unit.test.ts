import { describe, expect, it } from 'vitest';
import { todayIso } from '../src/shared/utils/date.ts';
import { formatAmountInput, parseAmount } from '../src/shared/utils/money.ts';
import { newRequestId } from '../src/shared/utils/request-id.ts';

describe('formatAmountInput', () => {
  it.each([
    ['25890', '25 890'],
    ['25 890', '25 890'],
    ['280000', '280 000'],
    ['12a3', '123'],
    ['007', '7'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(formatAmountInput(input)).toBe(expected);
  });
});

describe('parseAmount', () => {
  it('убирает пробелы между тысячами', () => {
    expect(parseAmount('25 890')).toBe(25890);
    expect(parseAmount('1 000')).toBe(1000);
  });

  it.each(['', 'abc', '12.5', '-5', '1,5'])('отклоняет %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('todayIso', () => {
  it('использует локальную дату без смещения UTC', () => {
    expect(todayIso(new Date(2026, 9, 10, 0, 30))).toBe('2026-10-10');
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('newRequestId', () => {
  it('возвращает UUID', () => {
    expect(newRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
