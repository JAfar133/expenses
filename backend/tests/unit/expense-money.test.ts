import { describe, expect, it } from 'vitest';
import { resolveMoney, type AmountContext } from '../../src/modules/expenses/expense-amount.ts';

const context: AmountContext = {
  base: 'AMD',
  currencies: ['AMD', 'RUB', 'USD', 'EUR'],
  rateOf: async (currency) => ({ USD: 380, EUR: 410, RUB: 4.5 })[currency],
};
const noRates: AmountContext = { ...context, rateOf: async () => undefined };

const amd = { cardCurrency: 'AMD', reportingCurrency: 'AMD' };
const usdCardAmdGroup = { cardCurrency: 'USD', reportingCurrency: 'AMD' };

describe('карта и группа в драммах', () => {
  it('как раньше: целая сумма без пересчёта и без исходной суммы', async () => {
    expect(await resolveMoney({ amount: 9703 }, amd, context)).toEqual({
      amount: 9703,
      cardCurrency: 'AMD',
      cardAmount: 9703,
      reportingCurrency: 'AMD',
      reportingAmount: 9703,
    });
  });

  it('ввод в долларах пересчитывается в драммы карты, исходная сумма сохраняется', async () => {
    expect(await resolveMoney({ amount: 10.5, currency: 'USD' }, amd, context)).toEqual({
      amount: 3990,
      original: { amount: 10.5, currency: 'USD', rate: 380 },
      cardCurrency: 'AMD',
      cardAmount: 3990,
      reportingCurrency: 'AMD',
      reportingAmount: 3990,
    });
  });
});

describe('карта в долларах, группа в драммах', () => {
  it('ввод по умолчанию в валюте карты: без пересчёта карты, отчётная сумма по курсу', async () => {
    const result = await resolveMoney({ amount: 10.5 }, usdCardAmdGroup, context);

    expect(result).toEqual({
      amount: 3990,
      cardCurrency: 'USD',
      cardAmount: 10.5,
      reportingCurrency: 'AMD',
      reportingAmount: 3990,
    });
  });

  it('ввод в драммах пересчитывается в доллары карты', async () => {
    const result = await resolveMoney({ amount: 38000, currency: 'AMD' }, usdCardAmdGroup, context);

    expect(result).toMatchObject({
      cardAmount: 100,
      reportingAmount: 38000,
      amount: 38000,
      original: { amount: 38000, currency: 'AMD', rate: 1 },
    });
  });

  it('ввод в евро: через драммы в доллары карты с округлением до центов', async () => {
    const result = await resolveMoney({ amount: 10, currency: 'EUR' }, usdCardAmdGroup, context);

    // 10 EUR = 4100 AMD = 10.789... USD
    expect(result).toMatchObject({ cardAmount: 10.79, reportingAmount: 4100, amount: 4100 });
    expect(result.original).toEqual({ amount: 10, currency: 'EUR', rate: 410 });
  });

  it('ручной курс для валюты ввода важнее курса из справочника', async () => {
    const result = await resolveMoney(
      { amount: 10, currency: 'USD', manualRate: 400 },
      usdCardAmdGroup,
      context,
    );

    expect(result).toMatchObject({ cardAmount: 10, reportingAmount: 4000, amount: 4000 });
  });
});

describe('карта в драммах, группа в долларах', () => {
  it('отчётная сумма в долларах по курсу', async () => {
    const result = await resolveMoney(
      { amount: 3800 },
      { cardCurrency: 'AMD', reportingCurrency: 'USD' },
      context,
    );

    expect(result).toMatchObject({
      cardAmount: 3800,
      reportingCurrency: 'USD',
      reportingAmount: 10,
    });
  });
});

describe('ошибки', () => {
  it('нет курса валюты отчётности: просит курс', async () => {
    await expect(resolveMoney({ amount: 5 }, usdCardAmdGroup, noRates)).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });
  });

  it('драммы вводятся целыми, остальные валюты до двух знаков', async () => {
    await expect(resolveMoney({ amount: 10.5 }, amd, context)).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
    await expect(resolveMoney({ amount: 1.234 }, usdCardAmdGroup, context)).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });

  it('валюта вне списка отклоняется', async () => {
    await expect(resolveMoney({ amount: 5, currency: 'XXX' }, amd, context)).rejects.toMatchObject({
      code: 'INVALID_CURRENCY',
    });
  });

  it('сумма, которая в карте округляется до нуля, отклоняется', async () => {
    await expect(
      resolveMoney(
        { amount: 1, currency: 'AMD' },
        { cardCurrency: 'USD', reportingCurrency: 'AMD' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});
