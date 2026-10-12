import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Cards in different currencies, the reporting currency of a group, editing and recalculation. */
let database: Database;
let t: TestApp;

const rows = <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params);
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.inject(
    { method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) },
    as,
  );

let keyCounter = 0;
const spend = (
  card: string,
  amount: number,
  extra: Record<string, unknown> = {},
  as = 'misha',
  category = 'кафе',
) =>
  call(
    'POST',
    '/api/expenses',
    as,
    { date: '2026-10-10', card, category, name: `Трата ${++keyCounter}`, amount, ...extra },
    { 'idempotency-key': `money-key-${keyCounter}-xxxxxxxx` },
  );
const list = async (as = 'misha') =>
  (await call('GET', '/api/expenses?limit=50&sort=date&direction=asc', as)).json().data.items;
const lastRow = async () =>
  (
    await rows<{
      amount: number;
      card_currency: string;
      card_amount: string;
      reporting_currency: string;
      reporting_amount: string;
      original_currency: string | null;
    }>(
      `SELECT amount, card_currency, card_amount, reporting_currency, reporting_amount, original_currency
         FROM expenses ORDER BY seq DESC LIMIT 1`,
    )
  )[0]!;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  t.rates.rates.set('USD', 380);
});

const createCard = async (name: string, currency?: string) => {
  const response = await call('POST', '/api/group/cards', 'misha', { name, currency });
  return { response, id: response.json().data?.id as string };
};

describe('валюта карты', () => {
  it('по умолчанию валюта группы; можно выбрать другую из списка', async () => {
    expect((await createCard('Обычная')).response.statusCode).toBe(201);
    expect((await createCard('Доллары', 'USD')).response.statusCode).toBe(201);

    const cards = (await call('GET', '/api/cards', 'misha')).json().data;
    expect(cards).toEqual([
      { name: 'Миша', currency: 'AMD' },
      { name: 'Настя', currency: 'AMD' },
      { name: 'Обычная', currency: 'AMD' },
      { name: 'Доллары', currency: 'USD' },
    ]);
  });

  it('валюта вне списка отклоняется', async () => {
    const created = await createCard('Странная', 'XXX');

    expect(created.response.statusCode).toBe(422);
    expect(created.response.json().error.code).toBe('INVALID_CURRENCY');
  });

  it('пока по карте нет трат, валюту можно изменить; потом нельзя', async () => {
    const { id } = await createCard('Новая');

    expect(
      (await call('PATCH', `/api/group/cards/${id}`, 'misha', { currency: 'EUR' })).statusCode,
    ).toBe(200);
    await spend('Новая', 10, { currency: 'EUR' });
    const blocked = await call('PATCH', `/api/group/cards/${id}`, 'misha', { currency: 'USD' });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('CARD_HAS_EXPENSES');
  });

  it('GET /api/group отдаёт список допустимых валют', async () => {
    const view = (await call('GET', '/api/group', 'misha')).json().data;

    expect(view.currencies).toEqual(['AMD', 'USD', 'RUB', 'EUR']);
    expect(view.cards[0].currency).toBe('AMD');
  });
});

describe('ввод трат', () => {
  it('карта в драммах работает как раньше', async () => {
    expect((await spend('Миша', 500)).statusCode).toBe(201);

    expect(await lastRow()).toMatchObject({
      amount: 500,
      card_currency: 'AMD',
      card_amount: '500.00',
      reporting_amount: '500.00',
    });
  });

  it('карта в долларах: сумма вводится в долларах без пересчёта, отчётная в драммах по курсу', async () => {
    await createCard('Доллары', 'USD');

    expect((await spend('Доллары', 10.5)).statusCode).toBe(201);

    expect(await lastRow()).toMatchObject({
      amount: 3990,
      card_currency: 'USD',
      card_amount: '10.50',
      reporting_currency: 'AMD',
      reporting_amount: '3990.00',
      original_currency: null,
    });
    expect((await list()).at(-1)).toMatchObject({
      amount: 10.5,
      currency: 'USD',
      reportingAmount: 3990,
      reportingCurrency: 'AMD',
    });
  });

  it('ввод в драммах на карту в долларах: пересчёт в доллары, исходная сумма сохраняется', async () => {
    await createCard('Доллары', 'USD');

    await spend('Доллары', 38000, { currency: 'AMD' });

    expect(await lastRow()).toMatchObject({ card_amount: '100.00', original_currency: 'AMD' });
    expect((await list()).at(-1).original).toEqual({ amount: 38000, currency: 'AMD', rate: 1 });
  });

  it('ручной курс применяется к валюте ввода', async () => {
    await createCard('Доллары', 'USD');

    await spend('Доллары', 10, { currency: 'EUR', rate: 400 });

    expect(await lastRow()).toMatchObject({ amount: 4000, card_amount: '10.53' });
  });

  it('нет курса валюты карты: понятная ошибка, ничего не сохранено', async () => {
    await createCard('Доллары', 'USD');
    t.rates.rates.delete('USD');

    const response = await spend('Доллары', 5, { currency: 'AMD' });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('RATE_UNAVAILABLE');
    expect(await rows('SELECT 1 FROM expenses')).toHaveLength(0);
  });
});

describe('итоги и графики в валюте отчётности', () => {
  it('траты на картах в разных валютах складываются в валюте группы', async () => {
    await createCard('Доллары', 'USD');
    await spend('Миша', 500);
    await spend('Доллары', 10.5);

    const summary = (await call('GET', '/api/analytics/summary', 'misha')).json().data.current;

    expect(summary).toMatchObject({ total: 4490, count: 2, max: 3990 });
    const byCurrency = (await call('GET', '/api/analytics/breakdown?by=currency', 'misha')).json()
      .data;
    expect(byCurrency.map((r: { key: string; total: number }) => [r.key, r.total])).toEqual([
      ['USD', 3990],
      ['AMD', 500],
    ]);
  });
});

describe('правка суммы', () => {
  it('сумма правится в валюте карты, остальные суммы следуют по тем же пропорциям', async () => {
    await createCard('Доллары', 'USD');
    await spend('Доллары', 10);
    const id = (await list()).at(-1).id;

    const response = await call('PATCH', `/api/expenses/${id}`, 'misha', { amount: 20 });

    expect(response.statusCode).toBe(200);
    expect(await lastRow()).toMatchObject({
      amount: 7600,
      card_amount: '20.00',
      reporting_amount: '7600.00',
    });
  });

  it('драммы правятся только целыми, доллары до двух знаков', async () => {
    await createCard('Доллары', 'USD');
    await spend('Миша', 500);
    await spend('Доллары', 10);
    const items = await list();
    const amd = items.find((i: { currency: string }) => i.currency === 'AMD').id;
    const usd = items.find((i: { currency: string }) => i.currency === 'USD').id;

    const bad = [
      await call('PATCH', `/api/expenses/${amd}`, 'misha', { amount: 10.5 }),
      await call('PATCH', `/api/expenses/${usd}`, 'misha', { amount: 10.555 }),
    ];

    expect(bad.map((r) => r.statusCode)).toEqual([422, 422]);
    expect(
      (await call('PATCH', `/api/expenses/${usd}`, 'misha', { amount: 10.55 })).statusCode,
    ).toBe(200);
  });

  it('трату нельзя перенести на карту в другой валюте, на карту в той же валюте можно', async () => {
    await createCard('Доллары', 'USD');
    await createCard('Ещё доллары', 'USD');
    await spend('Доллары', 10);
    const id = (await list()).at(-1).id;

    const other = await call('PATCH', `/api/expenses/${id}`, 'misha', { card: 'Миша' });
    const same = await call('PATCH', `/api/expenses/${id}`, 'misha', { card: 'Ещё доллары' });

    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('CARD_CURRENCY_MISMATCH');
    expect(same.statusCode).toBe(200);
  });
});

describe('смена валюты отчётности группы', () => {
  it('пересчитывает все траты: карты в новой валюте сохраняют точную сумму', async () => {
    await createCard('Доллары', 'USD');
    await spend('Миша', 3800);
    await spend('Доллары', 10.5);

    const response = await call('PUT', '/api/group/reporting-currency', 'misha', {
      currency: 'USD',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.recalculated).toBe(2);
    const items = await list();
    expect(
      items.map((i: { reportingAmount: number; reportingCurrency: string }) => [
        i.reportingAmount,
        i.reportingCurrency,
      ]),
    ).toEqual([
      [10, 'USD'],
      [10.5, 'USD'],
    ]);
    const summary = (await call('GET', '/api/analytics/summary', 'misha')).json().data.current;
    expect(summary.total).toBe(20.5);
    expect((await call('GET', '/api/config', 'misha')).json().data).toEqual({
      currency: 'USD',
      baseCurrency: 'AMD',
    });
  });

  it('новые траты считаются уже в новой валюте отчётности', async () => {
    await call('PUT', '/api/group/reporting-currency', 'misha', { currency: 'USD' });

    await spend('Миша', 7600);

    expect(await lastRow()).toMatchObject({ reporting_currency: 'USD', reporting_amount: '20.00' });
  });

  it('нет курса новой валюты, неизвестная валюта и участник: отказ без изменений', async () => {
    await spend('Миша', 3800);
    t.rates.rates.delete('EUR');

    const noRate = await call('PUT', '/api/group/reporting-currency', 'misha', { currency: 'EUR' });
    const unknown = await call('PUT', '/api/group/reporting-currency', 'misha', {
      currency: 'XXX',
    });
    const member = await call('PUT', '/api/group/reporting-currency', 'nastya', {
      currency: 'USD',
    });

    expect([noRate.statusCode, unknown.statusCode, member.statusCode]).toEqual([422, 422, 403]);
    expect(noRate.json().error.code).toBe('RATE_UNAVAILABLE');
    expect((await rows('SELECT reporting_currency FROM groups'))[0]).toEqual({
      reporting_currency: 'AMD',
    });
    expect((await lastRow()).reporting_amount).toBe('3800.00');
  });
});

describe('группа с валютой отчётности, созданная администратором', () => {
  it('карта владельца в валюте группы, ввод и итоги в ней', async () => {
    const created = await call('POST', '/api/admin/groups', 'misha', {
      name: 'Доллары',
      currency: 'USD',
    });
    const token = created.json().data.token;
    await t.app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/accept`,
      headers: { origin: TEST_ORIGIN },
      payload: { username: 'olga', displayName: 'Ольга', password: 'a-long-enough-password' },
    });

    expect((await call('GET', '/api/config', 'olga')).json().data.currency).toBe('USD');
    expect((await call('GET', '/api/cards', 'olga')).json().data).toEqual([
      { name: 'Ольга', currency: 'USD' },
    ]);
    expect((await spend('Ольга', 12.34, {}, 'olga')).statusCode).toBe(201);
    const summary = (await call('GET', '/api/analytics/summary', 'olga')).json().data.current;
    expect(summary.total).toBe(12.34);
  });
});
