import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;
let t: TestApp;

const add = (card: string, category: string, name: string, amount: number) =>
  new PostgresExpenseRepository(database).insertPending(
    database,
    { date: '2026-10-10', card, category, name, amount },
    'misha',
  );

const get = (url: string) => t.inject({ method: 'GET', url });
const totalOf = async (query = '') =>
  (await get(`/api/analytics/summary${query}`)).json().data.current.total as number;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expenses; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database, { now: () => new Date('2026-10-15T09:00:00Z') });
  await add('Миша', 'кафе', 'Латте', 500);
  await add('Миша', 'продукты', 'Хлеб', 200);
  await add('Настя', 'продукты', 'Молоко', 300);
});

const archive = (table: 'cards' | 'categories', name: string) =>
  database.query(`UPDATE ${table} SET archived_at = now() WHERE name = $1`, [name]);

describe('архив в анализе', () => {
  it('траты архивной категории по умолчанию не считаются', async () => {
    await archive('categories', 'кафе');

    expect(await totalOf()).toBe(500);
    const breakdown = (await get('/api/analytics/breakdown?by=category')).json().data;
    expect(breakdown.map((row: { key: string }) => row.key)).toEqual(['продукты']);
  });

  it('траты архивной карты по умолчанию не считаются', async () => {
    await archive('cards', 'Настя');

    expect(await totalOf()).toBe(700);
    const list = (await get('/api/expenses?limit=50')).json().data.items;
    expect(list.map((item: { name: string }) => item.name).sort()).toEqual(['Латте', 'Хлеб']);
  });

  it('includeArchived=true возвращает архивное', async () => {
    await archive('categories', 'кафе');
    await archive('cards', 'Настя');

    expect(await totalOf('?includeArchived=true')).toBe(1000);
  });

  it('выбранная в фильтре архивная категория или карта показывается', async () => {
    await archive('categories', 'кафе');
    await archive('cards', 'Настя');

    expect(await totalOf(`?categories=${encodeURIComponent('кафе')}`)).toBe(500);
    expect(await totalOf(`?cards=${encodeURIComponent('Настя')}`)).toBe(300);
  });

  it('лимиты считают все траты, в том числе архивных категорий', async () => {
    await archive('categories', 'кафе');
    await t.inject({
      method: 'POST',
      url: '/api/group/budgets',
      payload: { categoryId: null, limit: 1000, periodKind: 'month' },
    });

    const budgets = (await get('/api/budgets')).json().data;
    expect(budgets[0]?.spent).toBe(1000);
  });

  it('список категорий для фильтра содержит архивные с пометкой', async () => {
    await archive('categories', 'кафе');

    const categories = (await get('/api/analytics/categories')).json().data;
    expect(categories).toEqual([
      { name: 'продукты', archived: false },
      { name: 'кафе', archived: true },
    ]);
  });
});
