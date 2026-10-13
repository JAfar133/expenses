import { describe, expect, it } from 'vitest';
import { resolveAmount, type AmountContext } from '../../src/modules/expenses/expense-amount.ts';

const context: AmountContext = {
  base: 'AMD',
  currencies: ['AMD', 'RUB', 'USD'],
  rateOf: async (currency) => ({ USD: 380, RUB: 4.5 })[currency],
};

const resolve = (input: Parameters<typeof resolveAmount>[0]) => resolveAmount(input, context);

describe('драммы', () => {
  it('целая сумма проходит без пересчёта и без исходной суммы', async () => {
    expect(await resolve({ amount: 9703, currency: 'AMD' })).toEqual({ amount: 9703 });
  });

  it('дробная сумма принимается, в целую колонку идёт округлённая', async () => {
    expect(await resolve({ amount: 10.5, currency: 'AMD' })).toEqual({ amount: 11 });
    expect(await resolve({ amount: 1234.4, currency: 'AMD' })).toEqual({ amount: 1234 });
  });

  it('больше двух знаков после запятой не принимается', async () => {
    await expect(resolve({ amount: 10.555, currency: 'AMD' })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
      message: 'Не более двух знаков после запятой',
    });
  });
});

describe('иностранная валюта', () => {
  it('пересчитывает по курсу из справочника и сохраняет исходную сумму', async () => {
    expect(await resolve({ amount: 10.5, currency: 'USD' })).toEqual({
      amount: 3990,
      original: { amount: 10.5, currency: 'USD', rate: 380 },
    });
  });

  it('ручной курс важнее курса из справочника', async () => {
    const result = await resolve({ amount: 10, currency: 'USD', manualRate: 400.5 });

    expect(result).toEqual({
      amount: 4005,
      original: { amount: 10, currency: 'USD', rate: 400.5 },
    });
  });

  it('округляет драммы до целого', async () => {
    expect((await resolve({ amount: 99.99, currency: 'RUB' })).amount).toBe(450);
  });

  it('работает, если курса из справочника нет, но задан ручной', async () => {
    const noRates = { ...context, rateOf: async () => undefined };

    const result = await resolveAmount({ amount: 5, currency: 'USD', manualRate: 390 }, noRates);

    expect(result.amount).toBe(1950);
  });

  it('без курса и без ручного курса просит указать курс', async () => {
    const noRates = { ...context, rateOf: async () => undefined };

    await expect(resolveAmount({ amount: 5, currency: 'USD' }, noRates)).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });
  });

  it('не принимает больше двух знаков после запятой', async () => {
    await expect(resolve({ amount: 1.234, currency: 'USD' })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });

  it.each([0, -1, 1_000_001])('не принимает некорректный ручной курс %s', async (manualRate) => {
    await expect(resolve({ amount: 5, currency: 'USD', manualRate })).rejects.toMatchObject({
      code: 'INVALID_RATE',
    });
  });

  it('не принимает сумму, которая в драммах меньше 1 или не помещается в базу', async () => {
    await expect(resolve({ amount: 0.01, currency: 'RUB', manualRate: 4 })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
    await expect(resolve({ amount: 999_999_999, currency: 'USD' })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
      message: 'Слишком большая сумма',
    });
  });

  it('не принимает валюту не из списка', async () => {
    await expect(resolve({ amount: 5, currency: 'GBP' })).rejects.toMatchObject({
      code: 'INVALID_CURRENCY',
    });
  });
});
