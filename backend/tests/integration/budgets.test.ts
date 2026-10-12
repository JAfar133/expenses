import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Limits: who sees and who changes them, how the spent amount is counted, the periods. */
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
const spend = (card: string, category: string, amount: number, as = 'misha', date?: string) =>
  call(
    'POST',
    '/api/expenses',
    as,
    { date: date ?? todayOf(), card, category, name: `Трата ${++keyCounter}`, amount },
    { 'idempotency-key': `budget-key-${keyCounter}-xxxxxxxx` },
  );
/** The test clock stands at 15 October 2026 (Yerevan); the amounts are added for this month */
const NOW = new Date('2026-10-15T09:00:00Z');
const todayOf = () => '2026-10-15';
const categoryId = async (name: string) =>
  (await rows<{ id: string }>('SELECT id FROM categories WHERE name = $1', [name]))[0]!.id;
const create = async (category: string | null, body: Record<string, unknown> = {}) =>
  call('POST', '/api/group/budgets', 'misha', {
    categoryId: category ? await categoryId(category) : null,
    limit: 1000,
    periodKind: 'month',
    ...body,
  });
const progress = async (as = 'misha') =>
  (await call('GET', '/api/budgets', as)).json().data as {
    category: string | null;
    limit: number;
    spent: number;
    remaining: number;
    percent: number;
    level: string;
    period: { from: string; to: string };
  }[];

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM budgets; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database, { now: () => NOW });
});

describe('создание и права', () => {
  it('владелец создаёт лимит на категорию и общий; их видят все', async () => {
    expect((await create('кафе', { limit: 5000 })).statusCode).toBe(201);
    expect((await create(null, { limit: 20000 })).statusCode).toBe(201);

    for (const user of ['misha', 'nastya']) {
      const list = await progress(user);
      expect(list.map((b) => [b.category, b.limit])).toEqual([
        [null, 20000],
        ['кафе', 5000],
      ]);
    }
  });

  it('участник не создаёт, не меняет и не удаляет', async () => {
    const id = (await create('кафе')).json().data.id;
    const mine = await categoryId('продукты');

    const attempts = [
      await call('POST', '/api/group/budgets', 'nastya', {
        categoryId: mine,
        limit: 1,
        periodKind: 'month',
      }),
      await call('PUT', `/api/group/budgets/${id}`, 'nastya', { limit: 1, periodKind: 'month' }),
      await call('DELETE', `/api/group/budgets/${id}`, 'nastya'),
    ];

    expect(attempts.map((r) => r.statusCode)).toEqual([403, 403, 403]);
  });

  it('второй лимит на ту же категорию и второй общий отклоняются', async () => {
    await create('кафе');
    await create(null);

    const again = await create('кафе');
    const totalAgain = await create(null);

    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('BUDGET_EXISTS');
    expect(totalAgain.statusCode).toBe(409);
  });

  it('неверные данные: лимит, период, число, чужая категория', async () => {
    const codes = [
      (await create('кафе', { limit: 0 })).json().error.code,
      (await create('кафе', { limit: 'много' })).json().error.code,
      (await create('кафе', { limit: 10.555 })).json().error.code,
      (await create('кафе', { periodKind: 'year' })).json().error.code,
      (await create('кафе', { periodKind: 'month_from_day', periodDay: 31 })).json().error.code,
      (await create('кафе', { periodKind: 'month_from_day' })).json().error.code,
    ];
    expect(codes).toEqual([
      'INVALID_LIMIT',
      'INVALID_LIMIT',
      'INVALID_LIMIT',
      'INVALID_PERIOD',
      'INVALID_PERIOD',
      'INVALID_PERIOD',
    ]);

    const [other] = await rows<{ id: string }>(
      "INSERT INTO groups (name, reporting_currency, timezone) VALUES ('B', 'AMD', 'UTC') RETURNING id",
    );
    const [foreign] = await rows<{ id: string }>(
      "INSERT INTO categories (group_id, name) VALUES ($1, 'чужая') RETURNING id",
      [other!.id],
    );
    const response = await call('POST', '/api/group/budgets', 'misha', {
      categoryId: foreign!.id,
      limit: 1,
      periodKind: 'month',
    });
    expect(response.statusCode).toBe(422);
  });

  it('изменение лимита и периода, удаление; чужой лимит недоступен (404)', async () => {
    const id = (await create('кафе', { limit: 1000 })).json().data.id;

    const changed = await call('PUT', `/api/group/budgets/${id}`, 'misha', {
      limit: 2500.5,
      periodKind: 'month_from_day',
      periodDay: 10,
    });
    expect(changed.statusCode).toBe(200);
    expect((await progress())[0]).toMatchObject({
      limit: 2500.5,
      period: { from: '2026-10-10', to: '2026-11-09' },
    });

    expect(
      (
        await call('PUT', '/api/group/budgets/00000000-0000-4000-8000-000000000000', 'misha', {
          limit: 1,
          periodKind: 'month',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/group/budgets/${id}`, 'misha')).statusCode).toBe(200);
    expect(await progress()).toEqual([]);
  });
});

describe('сколько потрачено и уровни', () => {
  it('считает траты категории за период; удалённые и другие категории не считаются', async () => {
    await create('кафе', { limit: 1000 });
    await spend('Миша', 'кафе', 300);
    await spend('Миша', 'кафе', 200);
    await spend('Миша', 'продукты', 999);
    await spend('Миша', 'кафе', 777, 'misha', '2026-09-20');
    const doomed = (await spend('Миша', 'кафе', 400)).json().data.id;
    await call('DELETE', `/api/expenses/${doomed}`, 'misha');

    const [budget] = await progress();

    expect(budget).toMatchObject({
      category: 'кафе',
      spent: 500,
      remaining: 500,
      percent: 50,
      level: 'ok',
    });
    expect(budget!.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('общий лимит считает все категории', async () => {
    await create(null, { limit: 2000 });
    await spend('Миша', 'кафе', 300);
    await spend('Миша', 'продукты', 700);

    expect((await progress())[0]).toMatchObject({ category: null, spent: 1000, percent: 50 });
  });

  it('уровни: до 80% обычный, с 80% предупреждение, с 100% превышение', async () => {
    await create('кафе', { limit: 1000 });

    expect((await progress())[0]!.level).toBe('ok');
    await spend('Миша', 'кафе', 800);
    expect((await progress())[0]).toMatchObject({ level: 'warn', percent: 80 });
    await spend('Миша', 'кафе', 250);
    expect((await progress())[0]).toMatchObject({ level: 'over', remaining: -50 });
  });

  it('участник видит расход только по доступным ему картам', async () => {
    await create(null, { limit: 5000 });
    await spend('Миша', 'кафе', 1000);
    await spend('Настя', 'кафе', 400, 'nastya');
    await database.query(
      "DELETE FROM card_access WHERE card_id = (SELECT id FROM cards WHERE name = 'Миша')",
    );

    expect((await progress('nastya'))[0]!.spent).toBe(400);
    expect((await progress('misha'))[0]!.spent).toBe(1400);
  });

  it('неделя: траты за пределами недели не считаются', async () => {
    await create('кафе', { periodKind: 'week' });
    await spend('Миша', 'кафе', 100, 'misha', '2026-10-14');
    await spend('Миша', 'кафе', 50, 'misha', '2026-10-09');

    const [budget] = await progress();

    expect(budget!.period).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(budget!.spent).toBe(100);
  });

  it('месяц с 20-го: октябрьские траты до 19-го относятся к прошлому периоду', async () => {
    await create('кафе', { periodKind: 'month_from_day', periodDay: 20 });
    await spend('Миша', 'кафе', 100, 'misha', '2026-10-15');
    await spend('Миша', 'кафе', 60, 'misha', '2026-09-22');

    const [budget] = await progress();

    expect(budget!.period).toEqual({ from: '2026-09-20', to: '2026-10-19' });
    expect(budget!.spent).toBe(160);
  });
});

describe('изоляция групп и валюта', () => {
  it('лимиты другой группы не видны', async () => {
    await create('кафе');
    const [other] = await rows<{ id: string }>(
      "INSERT INTO groups (name, reporting_currency, timezone) VALUES ('B', 'AMD', 'UTC') RETURNING id",
    );
    await database.query(
      "INSERT INTO budgets (group_id, limit_amount, period_kind) VALUES ($1, 77, 'month')",
      [other!.id],
    );

    expect((await progress()).map((b) => b.limit)).toEqual([1000]);
  });

  it('при смене валюты отчётности лимиты пересчитываются по курсу', async () => {
    t.rates.rates.set('USD', 380);
    await create('кафе', { limit: 38000 });

    await call('PUT', '/api/group/reporting-currency', 'misha', { currency: 'USD' });

    expect((await progress())[0]!.limit).toBe(100);
  });
});
