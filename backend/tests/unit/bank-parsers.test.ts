import { describe, expect, it } from 'vitest';
import { idbankParser } from '../../src/modules/bank-import/parsers/idbank.ts';
import { parserFor } from '../../src/modules/bank-import/parsers/registry.ts';

const TITLE = 'IDBank: GNUM';
const read = (title: string, body: string) =>
  idbankParser.parse({
    title,
    body,
    fields: {},
    receivedAt: new Date('2026-10-17T10:00:00Z'),
    timezone: 'Asia/Yerevan',
  });
const BODY =
  '1,540.00 AMD\nVISA **5386 - MNACORD: 3,238.96 AMD\nURARTU ZAQYAN, AM 16.10.2026 20:40';

describe('парсер IDBank: покупка (GNUM)', () => {
  it('читает сумму покупки, а не остаток, валюту, продавца, карту и время банка (UTC+4)', () => {
    const result = read(TITLE, BODY);

    expect(result.kind).toBe('expense');
    if (result.kind !== 'expense') return;
    expect(result.purchase).toMatchObject({
      amount: 1540,
      currency: 'AMD',
      merchant: 'URARTU ZAQYAN',
      cardLast4: '5386',
      localDate: '2026-10-16',
    });
    expect(result.purchase.occurredAt.toISOString()).toBe('2026-10-16T16:40:00.000Z');
  });

  it('первая строка текста может повторять заголовок, а в заголовке может быть пусто', () => {
    const result = read('', `IDBank: GNUM\n${BODY}`);

    expect(result.kind).toBe('expense');
  });

  it('разные валюты, копейки и разделители суммы', () => {
    const readAmount = (amount: string) => {
      const result = read(TITLE, `${amount}\nVISA **1111 - X: 1.00 AMD\nSHOP, US 01.02.2026 08:05`);
      return result.kind === 'expense' ? [result.purchase.amount, result.purchase.currency] : null;
    };

    expect(readAmount('12.50 USD')).toEqual([12.5, 'USD']);
    expect(readAmount('1 540,00 AMD')).toEqual([1540, 'AMD']);
    expect(readAmount('1,540 AMD')).toEqual([1540, 'AMD']);
    expect(readAmount('1.540,25 RUB')).toEqual([1540.25, 'RUB']);
    expect(readAmount('99 EUR')).toEqual([99, 'EUR']);
  });

  it('продавец с запятой и лишними пробелами читается целиком', () => {
    const result = read(
      TITLE,
      '500.00 AMD\nVISA **5386 - M: 1.00 AMD\n  CAFE  A, B  STREET , AM 01.01.2026 00:00',
    );

    expect(result.kind === 'expense' && result.purchase.merchant).toBe('CAFE A, B STREET');
  });

  it('другие виды уведомлений не импортируются', () => {
    expect(read('IDBank: MTUM', BODY).kind).toBe('unsupported');
    expect(read('Другой банк', BODY).kind).toBe('unsupported');
  });

  it('нечитаемый текст даёт ошибку, а не частично заполненную операцию', () => {
    expect(read(TITLE, 'что-то непонятное').kind).toBe('error');
    expect(read(TITLE, BODY.replace('1,540.00 AMD\n', '')).kind).toBe('error');
    expect(read(TITLE, BODY.replace('16.10.2026', '31.02.2026')).kind).toBe('error');
    expect(read(TITLE, BODY.replace('1,540.00', '0.00')).kind).toBe('error');
  });
});

describe('парсер IDBank: покупка по SMS', () => {
  const SMS =
    'GNUM\n5,632.00 AMD\n4703***7181,\nYEREVAN CITY AVAN ARINJ, AM\n17.10.2026 19:40\nMNACORD: 94,218.04 AMD';

  it('читает сумму покупки (не остаток), цифры карты, продавца и время', () => {
    const result = read('IDBank', SMS);

    expect(result.kind).toBe('expense');
    if (result.kind !== 'expense') return;
    expect(result.purchase).toMatchObject({
      amount: 5632,
      currency: 'AMD',
      merchant: 'YEREVAN CITY AVAN ARINJ',
      cardLast4: '7181',
      localDate: '2026-10-17',
    });
    expect(result.purchase.occurredAt.toISOString()).toBe('2026-10-17T15:40:00.000Z');
  });

  it('отправитель в заголовке может быть любым, а другой вид SMS не импортируется', () => {
    expect(read('', SMS).kind).toBe('expense');
    expect(read('IDBank', SMS.replace('GNUM', 'MTUM')).kind).toBe('unsupported');
  });

  it('текст SMS без нужных строк: ошибка, а не неполная операция', () => {
    expect(read('IDBank', 'GNUM\n5,632.00 AMD').kind).toBe('error');
    expect(read('IDBank', SMS.replace('17.10.2026 19:40\n', '')).kind).toBe('error');
  });
});

describe('парсер IDBank: поле type (push / sms)', () => {
  const SMS =
    'GNUM\n5,632.00 AMD\n4703***7181,\nYEREVAN CITY AVAN ARINJ, AM\n17.10.2026 19:40\nMNACORD: 94,218.04 AMD';
  const withType = (title: string, body: string, type: string) =>
    idbankParser.parse({
      title,
      body,
      fields: { type },
      receivedAt: new Date('2026-10-17T10:00:00Z'),
      timezone: 'Asia/Yerevan',
    });

  it('type=sms читает SMS и отмечает канал; type=push читает push', () => {
    const sms = withType('IDBank', SMS, 'SMS');
    const push = withType('IDBank: GNUM', BODY, 'push');

    expect(sms.kind === 'expense' && sms.purchase).toMatchObject({ amount: 5632, channel: 'sms' });
    expect(push.kind === 'expense' && push.purchase).toMatchObject({
      amount: 1540,
      channel: 'push',
    });
  });

  it('указанный тип строгий: SMS, названный push, и push, названный sms, не читаются', () => {
    expect(withType('IDBank', SMS, 'push').kind).toBe('unsupported');
    expect(withType('IDBank: GNUM', BODY, 'sms').kind).toBe('unsupported');
  });

  it('без type или с другим значением читаются обе формы, как раньше', () => {
    expect(withType('IDBank', SMS, 'whatever').kind).toBe('expense');
    expect(read(TITLE, BODY).kind).toBe('expense');
  });
});

describe('реестр банков', () => {
  it('находит парсер по источнику без учёта регистра, неизвестный банк даёт undefined', () => {
    expect(parserFor('IDBank')?.source).toBe('idbank');
    expect(parserFor('unknown')).toBeUndefined();
  });
});
