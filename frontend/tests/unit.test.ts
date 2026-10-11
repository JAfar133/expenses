import { describe, expect, it } from 'vitest';
import { setAppTimezone, todayIso } from '../src/shared/utils/date.ts';
import { offsetLabel, timezoneOptions } from '../src/features/settings/model/timezones.ts';
import {
  formatAmountInput,
  formatDecimalInput,
  formatMoney,
  parseAmount,
  parseDecimal,
} from '../src/shared/utils/money.ts';
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

describe('formatDecimalInput', () => {
  const money = { maxDecimals: 2, group: true };

  it.each([
    ['10.5', '10,5'],
    ['10,50', '10,50'],
    ['1234,567', '1 234,56'],
    ['1234', '1 234'],
    [',5', '0,5'],
    ['007,1', '7,1'],
    ['1,2,3', '1,23'],
    ['abc', ''],
    ['', ''],
  ])('сумма %s -> %s', (input, expected) => {
    expect(formatDecimalInput(input, money)).toBe(expected);
  });

  it('курс: до шести знаков, без группировки', () => {
    expect(formatDecimalInput('1234.5678901', { maxDecimals: 6 })).toBe('1234,567890');
  });
});

describe('parseDecimal', () => {
  it.each([
    ['10,5', 10.5],
    ['10.5', 10.5],
    ['1 234,56', 1234.56],
    ['7', 7],
  ])('%s -> %s', (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });

  it.each(['', 'abc', '5,', ',5', '-1', '1,2,3'])('отклоняет %j', (input) => {
    expect(parseDecimal(input)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('группирует тысячи обычными пробелами и использует запятую', () => {
    expect(formatMoney(3990)).toBe('3 990');
    expect(formatMoney(10.5)).toBe('10,5');
    expect(formatMoney(380.123456, 6)).toBe('380,123456');
  });
});

describe('todayIso и часовой пояс пользователя', () => {
  // Для Еревана (UTC+4) уже 15 октября, для Нью-Йорка (UTC−4) ещё 14-е
  const instant = new Date('2026-10-14T21:30:00Z');

  it('по часовому поясу пользователя, а не устройства', () => {
    setAppTimezone('Asia/Yerevan');
    expect(todayIso(instant)).toBe('2026-10-15');

    setAppTimezone('America/New_York');
    expect(todayIso(instant)).toBe('2026-10-14');
  });

  it('граница суток: сразу после полуночи по поясу пользователя наступает новый день', () => {
    setAppTimezone('Asia/Yerevan');

    expect(todayIso(new Date('2026-10-14T19:59:59Z'))).toBe('2026-10-14');
    expect(todayIso(new Date('2026-10-14T20:00:00Z'))).toBe('2026-10-15');
  });

  it('некорректный пояс или undefined: пояс устройства', () => {
    const local = new Date(2026, 9, 10, 0, 30);
    setAppTimezone('Mars/Phobos');
    expect(todayIso(local)).toBe('2026-10-10');
    setAppTimezone(undefined);
    expect(todayIso(local)).toBe('2026-10-10');
  });
});

describe('часовые пояса для выбора', () => {
  it('offsetLabel: смещение в виде UTC±часы[:минуты]', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    expect(offsetLabel('Asia/Yerevan', winter)).toBe('UTC+4');
    expect(offsetLabel('Asia/Kolkata', winter)).toBe('UTC+5:30');
    expect(offsetLabel('America/New_York', winter)).toBe('UTC-5');
    expect(offsetLabel('UTC', winter)).toBe('UTC');
  });

  it('timezoneOptions: все пояса от западных к восточным, текущий всегда в списке', () => {
    const options = timezoneOptions('Asia/Yerevan');
    const index = (zone: string) => options.findIndex((o) => o.value === zone);

    expect(options.length).toBeGreaterThan(100);
    expect(index('America/New_York')).toBeLessThan(index('Europe/Moscow'));
    expect(index('Europe/Moscow')).toBeLessThan(index('Asia/Yerevan'));
    expect(options[index('Asia/Yerevan')]!.label).toBe('Asia/Yerevan (UTC+4)');
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });

  it('timezoneOptions: неизвестный браузеру пояс всё равно показан', () => {
    expect(
      timezoneOptions('Nowhere/Land'.replace('Nowhere/Land', 'UTC')).some((o) => o.value === 'UTC'),
    ).toBe(true);
  });
});
