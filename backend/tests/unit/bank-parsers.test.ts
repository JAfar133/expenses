import { describe, expect, it } from 'vitest';
import { idbankParser } from '../../src/modules/bank-import/parsers/idbank.ts';
import { parserFor } from '../../src/modules/bank-import/parsers/registry.ts';

const TITLE = 'IDBank: GNUM';
const BODY =
  '1,540.00 AMD\nVISA **5386 - MNACORD: 3,238.96 AMD\nURARTU ZAQYAN, AM 16.10.2026 20:40';

describe('парсер IDBank: покупка (GNUM)', () => {
  it('читает сумму покупки, а не остаток, валюту, продавца, карту и время банка (UTC+4)', () => {
    const result = idbankParser.parse(TITLE, BODY);

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
    const result = idbankParser.parse('', `IDBank: GNUM\n${BODY}`);

    expect(result.kind).toBe('expense');
  });

  it('разные валюты, копейки и разделители суммы', () => {
    const read = (amount: string) => {
      const result = idbankParser.parse(
        TITLE,
        `${amount}\nVISA **1111 - X: 1.00 AMD\nSHOP, US 01.02.2026 08:05`,
      );
      return result.kind === 'expense' ? [result.purchase.amount, result.purchase.currency] : null;
    };

    expect(read('12.50 USD')).toEqual([12.5, 'USD']);
    expect(read('1 540,00 AMD')).toEqual([1540, 'AMD']);
    expect(read('1,540 AMD')).toEqual([1540, 'AMD']);
    expect(read('1.540,25 RUB')).toEqual([1540.25, 'RUB']);
    expect(read('99 EUR')).toEqual([99, 'EUR']);
  });

  it('продавец с запятой и лишними пробелами читается целиком', () => {
    const result = idbankParser.parse(
      TITLE,
      '500.00 AMD\nVISA **5386 - M: 1.00 AMD\n  CAFE  A, B  STREET , AM 01.01.2026 00:00',
    );

    expect(result.kind === 'expense' && result.purchase.merchant).toBe('CAFE A, B STREET');
  });

  it('другие виды уведомлений не импортируются', () => {
    expect(idbankParser.parse('IDBank: MTUM', BODY).kind).toBe('unsupported');
    expect(idbankParser.parse('Другой банк', BODY).kind).toBe('unsupported');
  });

  it('нечитаемый текст даёт ошибку, а не частично заполненную операцию', () => {
    expect(idbankParser.parse(TITLE, 'что-то непонятное').kind).toBe('error');
    expect(idbankParser.parse(TITLE, BODY.replace('1,540.00 AMD\n', '')).kind).toBe('error');
    expect(idbankParser.parse(TITLE, BODY.replace('16.10.2026', '31.02.2026')).kind).toBe('error');
    expect(idbankParser.parse(TITLE, BODY.replace('1,540.00', '0.00')).kind).toBe('error');
  });
});

describe('реестр банков', () => {
  it('находит парсер по источнику без учёта регистра, неизвестный банк даёт undefined', () => {
    expect(parserFor('IDBank')?.source).toBe('idbank');
    expect(parserFor('unknown')).toBeUndefined();
  });
});
