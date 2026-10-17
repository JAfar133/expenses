import { describe, expect, it } from 'vitest';
import { appleWalletParser } from '../../src/modules/bank-import/parsers/apple-wallet.ts';
import { readMoney } from '../../src/modules/bank-import/money-text.ts';

const RECEIVED = new Date('2026-10-17T09:14:00Z');
const read = (fields: Record<string, unknown>) =>
  appleWalletParser.parse({
    title: typeof fields.title === 'string' ? fields.title : '',
    body: typeof fields.body === 'string' ? fields.body : '',
    fields,
    receivedAt: RECEIVED,
    timezone: 'Asia/Yerevan',
  });

describe('сумма и валюта из текста', () => {
  it('разные записи', () => {
    expect(readMoney('1950 AMD')).toEqual({ amount: 1950, currency: 'AMD' });
    expect(readMoney('AMD 1,950.00')).toEqual({ amount: 1950, currency: 'AMD' });
    expect(readMoney('1 950,50 ֏')).toEqual({ amount: 1950.5, currency: 'AMD' });
    expect(readMoney('$12.50')).toEqual({ amount: 12.5, currency: 'USD' });
    expect(readMoney('12.50 usd')).toEqual({ amount: 12.5, currency: 'USD' });
    expect(readMoney('€5')).toEqual({ amount: 5, currency: 'EUR' });
    expect(readMoney('1950')).toEqual({ amount: 1950 });
  });

  it('число в названии магазина не принимается за сумму', () => {
    expect(readMoney('Food Court4 Kiosk 4 — 1950 AMD')).toEqual({ amount: 1950, currency: 'AMD' });
  });

  it('пустой и нечитаемый текст', () => {
    expect(readMoney('')).toBeUndefined();
    expect(readMoney('просто слова')).toBeUndefined();
  });
});

describe('парсер Apple Wallet', () => {
  it('пример из задания: продавец, сумма и валюта, время с поясом', () => {
    const result = read({
      source: 'apple_wallet',
      title: 'Food Court4 Kiosk 4',
      body: 'Food Court4 Kiosk 4 — 1950 AMD',
      transaction: 'Food Court4 Kiosk 4, 1950 AMD',
      merchant: 'Food Court4 Kiosk 4',
      amount: '1950 AMD',
      card: 'IDBank Visa',
      name: 'Food Court4 Kiosk 4',
      receivedAt: '2026-10-17T13:14:00+04:00',
    });

    expect(result.kind).toBe('expense');
    if (result.kind !== 'expense') return;
    expect(result.purchase).toMatchObject({
      amount: 1950,
      currency: 'AMD',
      merchant: 'Food Court4 Kiosk 4',
      cardHint: 'IDBank Visa',
      localDate: '2026-10-17',
    });
    expect(result.purchase.cardLast4).toBeUndefined();
    expect(result.purchase.occurredAt.toISOString()).toBe('2026-10-17T09:14:00.000Z');
  });

  it('карта из `card` не считается цифрами; `cardLast4` берётся как цифры', () => {
    const withCard = read({ merchant: 'Shop', amount: '10 USD', card: 'Visa •••• 1234' });
    const withDigits = read({ merchant: 'Shop', amount: '10 USD', cardLast4: '•••• 5386' });

    expect(withCard.kind === 'expense' && withCard.purchase.cardLast4).toBeUndefined();
    expect(withDigits.kind === 'expense' && withDigits.purchase.cardLast4).toBe('5386');
  });

  it('только title и body: продавец из заголовка, сумма из текста; время получения запроса', () => {
    const result = read({ title: 'Urartu Zaqyan', body: '1540 AMD' });

    expect(result.kind === 'expense' && result.purchase).toMatchObject({
      amount: 1540,
      currency: 'AMD',
      merchant: 'Urartu Zaqyan',
      localDate: '2026-10-17',
    });
  });

  it('сумма числом, валюта отдельным полем', () => {
    const result = read({ merchant: 'Shop', amount: 1950, currency: 'amd' });

    expect(result.kind === 'expense' && result.purchase).toMatchObject({
      amount: 1950,
      currency: 'AMD',
    });
  });

  it('продавец достаётся из текста перед суммой, если полей нет', () => {
    const result = read({ body: 'Coffee House — 1200 AMD' });

    expect(result.kind === 'expense' && result.purchase.merchant).toBe('Coffee House');
  });

  it('категория, номер операции и неизвестные поля не мешают', () => {
    const result = read({
      merchant: 'Shop',
      amount: '5 EUR',
      category: 'Еда и напитки',
      transactionId: 'T-1',
      device: { name: 'iPhone', model: '17' },
      someUnknownField: 'x',
    });

    expect(result.kind === 'expense' && result.purchase).toMatchObject({
      categoryHint: 'Еда и напитки',
      transactionId: 'T-1',
    });
  });

  it('нет суммы, валюты или продавца: ошибка, а не неполная операция', () => {
    expect(read({ merchant: 'Shop' }).kind).toBe('error');
    expect(read({ merchant: 'Shop', amount: '1950' }).kind).toBe('error');
    expect(read({ amount: '1950 AMD' }).kind).toBe('error');
    expect(read({ merchant: 'Shop', amount: '0 AMD' }).kind).toBe('error');
  });

  it('время получения читается и под написанием «recivedAt» / «received_at»', () => {
    for (const name of ['recivedAt', 'received_at', 'recived_at']) {
      const result = read({
        merchant: 'Shop',
        amount: '1 AMD',
        [name]: '2026-10-17T22:30:00+04:00',
      });

      expect(result.kind === 'expense' && result.purchase.occurredAt.toISOString()).toBe(
        '2026-10-17T18:30:00.000Z',
      );
    }
  });

  it('нечитаемое время получения заменяется временем сервера', () => {
    const result = read({ merchant: 'Shop', amount: '1 AMD', receivedAt: 'вчера' });

    expect(result.kind === 'expense' && result.purchase.occurredAt).toEqual(RECEIVED);
  });
});
