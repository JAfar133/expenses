import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/**
 * Groups and access to cards. Group A (the test app's default group): misha is the owner, nastya a member.
 * Group B: olga is the owner, ivan a member. Nastya sees only the cards she was given.
 */
let database: Database;
let t: TestApp;
let expenses: PostgresExpenseRepository;

const row = (card: string, name: string, amount = 100) => ({
  date: '2026-10-10',
  card,
  category: 'кафе',
  name,
  amount,
});

const get = (url: string, as: string) => t.inject({ method: 'GET', url }, as);
const rows = <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params);

async function addUser(username: string, role: 'owner' | 'member', groupId: string) {
  await t.authRepository.upsertUser(username, username, { timezone: 'UTC' });
  const [user] = await rows<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]);
  await database.query('INSERT INTO memberships (user_id, group_id, role) VALUES ($1, $2, $3)', [
    user!.id,
    groupId,
    role,
  ]);
  return user!.id;
}

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

let cardIds: Record<string, string>;

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expenses; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  expenses = new PostgresExpenseRepository(database);

  const [a] = await rows<{ id: string }>('SELECT id FROM groups');
  const [b] = await rows<{ id: string }>(
    "INSERT INTO groups (name, reporting_currency, timezone) VALUES ('Другая', 'AMD', 'UTC') RETURNING id",
  );
  const groupB = b!.id;
  await database.query(
    "INSERT INTO cards (group_id, name, currency, position) VALUES ($1, 'Чужая', 'AMD', 0)",
    [groupB],
  );
  await database.query("INSERT INTO categories (group_id, name) VALUES ($1, 'чужая-категория')", [
    groupB,
  ]);
  await addUser('olga', 'owner', groupB);
  const ivan = await addUser('ivan', 'member', groupB);
  const [theirCard] = await rows<{ id: string }>("SELECT id FROM cards WHERE name = 'Чужая'");
  await database.query("INSERT INTO card_access VALUES ($1, $2, 'edit')", [theirCard!.id, ivan]);

  // Group A: nastya may only see the card "Миша" and may add to it; the card "Настя" is hidden from her
  const cards = await rows<{ id: string; name: string }>(
    'SELECT id, name FROM cards WHERE group_id = $1',
    [a!.id],
  );
  cardIds = Object.fromEntries(cards.map((card) => [card.name, card.id]));
  await database.query(
    "DELETE FROM card_access WHERE card_id = $1 AND user_id = (SELECT id FROM users WHERE username = 'nastya')",
    [cardIds['Настя']],
  );

  await expenses.insertPending(database, row('Миша', 'Кофе миши'), 'misha');
  await expenses.insertPending(database, row('Настя', 'Платье насти'), 'misha');
  await expenses.insertPending(database, row('Чужая', 'Чужой чай'), 'olga');
});

const names = async (as: string) =>
  (await get('/api/expenses?limit=50', as)).json().data.items.map((i: { name: string }) => i.name);

describe('видимость операций', () => {
  it('владелец видит все карты своей группы и ничего чужого', async () => {
    expect((await names('misha')).sort()).toEqual(['Кофе миши', 'Платье насти']);
  });

  it('участник видит только карты, к которым у него есть доступ', async () => {
    expect(await names('nastya')).toEqual(['Кофе миши']);
  });

  it('другая группа видит только своё', async () => {
    expect(await names('olga')).toEqual(['Чужой чай']);
    expect(await names('ivan')).toEqual(['Чужой чай']);
  });

  it('пользователь без группы ничего не видит', async () => {
    await t.authRepository.upsertUser('lone', 'lone', { timezone: 'UTC' });

    expect(await names('lone')).toEqual([]);
  });
});

describe('скрытая карта не просачивается в агрегаты', () => {
  it('итоги, разбивки, динамика, авторы, подсказки и категории', async () => {
    const summary = (await get('/api/analytics/summary', 'nastya')).json().data.current;
    expect(summary).toMatchObject({ total: 100, count: 1 });

    const byCard = (await get('/api/analytics/breakdown?by=card', 'nastya')).json().data;
    expect(byCard.map((r: { key: string }) => r.key)).toEqual(['Миша']);

    const byName = (await get('/api/analytics/breakdown?by=name', 'nastya')).json().data;
    expect(byName.map((r: { key: string }) => r.key)).toEqual(['Кофе миши']);

    const series = (await get('/api/analytics/timeseries?granularity=month&splitBy=card', 'nastya'))
      .json()
      .data.map((p: { key?: string }) => p.key);
    expect(series).toEqual(['Миша']);

    const authors = (await get('/api/analytics/authors', 'nastya')).json().data;
    expect(authors).toEqual([expect.objectContaining({ value: 'misha', count: 1 })]);

    const suggestions = (await get('/api/name-suggestions', 'nastya')).json().data;
    expect(suggestions.map((s: { name: string }) => s.name)).toEqual(['Кофе миши']);
  });

  it('фильтр по скрытой карте не возвращает её записи', async () => {
    const response = await get(`/api/expenses?cards=${encodeURIComponent('Настя')}`, 'nastya');

    expect(response.json().data.items).toEqual([]);
  });

  it('чужая категория и чужая карта не попадают в справочники', async () => {
    const categories = (await get('/api/categories', 'misha')).json().data;
    expect(categories).not.toContain('чужая-категория');
    const cards = (await get('/api/cards', 'misha')).json().data;
    expect(cards).toEqual(['Миша', 'Настя']);
  });
});

describe('добавление трат', () => {
  const add = (card: string, as: string) =>
    t.inject(
      {
        method: 'POST',
        url: '/api/expenses',
        headers: { 'idempotency-key': `key-${Math.random().toString(36).slice(2)}-xx` },
        payload: { ...row(card, 'Новая трата') },
      },
      as,
    );

  it('участник видит в форме только карты с доступом edit', async () => {
    expect((await get('/api/cards', 'nastya')).json().data).toEqual(['Миша']);
  });

  it('на карту с доступом можно, на скрытую или чужую нельзя', async () => {
    expect((await add('Миша', 'nastya')).statusCode).toBe(201);
    expect((await add('Настя', 'nastya')).statusCode).toBe(422);
    expect((await add('Чужая', 'nastya')).statusCode).toBe(422);
    expect((await add('Миша', 'olga')).statusCode).toBe(422);
  });

  it('доступ view не даёт добавлять, но даёт смотреть', async () => {
    await database.query(
      "UPDATE card_access SET level = 'view' WHERE card_id = $1 AND user_id = (SELECT id FROM users WHERE username = 'nastya')",
      [cardIds['Миша']],
    );

    expect((await add('Миша', 'nastya')).statusCode).toBe(422);
    expect(await names('nastya')).toEqual(['Кофе миши']);
    expect((await get('/api/cards', 'nastya')).json().data).toEqual([]);
  });

  it('архивная карта не предлагается, а старые траты по ней остаются видны', async () => {
    await database.query('UPDATE cards SET archived_at = now() WHERE id = $1', [cardIds['Миша']]);

    expect((await get('/api/cards', 'misha')).json().data).toEqual(['Настя']);
    expect((await add('Миша', 'misha')).statusCode).toBe(422);
    expect(await names('nastya')).toEqual(['Кофе миши']);
  });
});

describe('правка и удаление', () => {
  const recordOf = async (name: string) =>
    (await rows<{ id: string }>('SELECT id FROM expenses WHERE name = $1', [name]))[0]!.id;

  it('владелец правит и удаляет траты своей группы', async () => {
    const id = await recordOf('Платье насти');

    const patched = await t.inject(
      { method: 'PATCH', url: `/api/expenses/${id}`, payload: { amount: 5 } },
      'misha',
    );
    expect(patched.statusCode).toBe(200);
    const removed = await t.inject({ method: 'DELETE', url: `/api/expenses/${id}` }, 'misha');
    expect(removed.statusCode).toBe(200);
  });

  it('участник не может править и удалять даже видимые траты', async () => {
    const id = await recordOf('Кофе миши');

    for (const request of [
      { method: 'PATCH' as const, url: `/api/expenses/${id}`, payload: { amount: 5 } },
      { method: 'DELETE' as const, url: `/api/expenses/${id}` },
    ]) {
      expect((await t.inject(request, 'nastya')).statusCode).toBe(403);
    }
  });

  it('владелец другой группы получает 404, как будто записи нет', async () => {
    const id = await recordOf('Кофе миши');

    for (const request of [
      { method: 'PATCH' as const, url: `/api/expenses/${id}`, payload: { amount: 5 } },
      { method: 'DELETE' as const, url: `/api/expenses/${id}` },
      { method: 'POST' as const, url: `/api/expenses/${id}/restore` },
    ]) {
      expect((await t.inject(request, 'olga')).statusCode).toBe(404);
    }
    expect((await rows('SELECT amount FROM expenses WHERE id = $1', [id]))[0]).toEqual({
      amount: 100,
    });
  });

  it('карту записи можно сменить только на карту своей группы', async () => {
    const id = await recordOf('Платье насти');

    const foreign = await t.inject(
      { method: 'PATCH', url: `/api/expenses/${id}`, payload: { card: 'Чужая' } },
      'misha',
    );
    expect(foreign.statusCode).toBe(422);
  });
});

describe('переименование карты', () => {
  it('новое имя видно сразу в операциях, графиках и фильтрах', async () => {
    await database.query("UPDATE cards SET name = 'Новая' WHERE id = $1", [cardIds['Миша']]);

    expect(
      (await get('/api/expenses?limit=50', 'misha'))
        .json()
        .data.items.map((i: { card: string }) => i.card)
        .sort(),
    ).toEqual(['Настя', 'Новая']);
    const byCard = (await get('/api/analytics/breakdown?by=card', 'misha')).json().data;
    expect(byCard.map((r: { key: string }) => r.key).sort()).toEqual(['Настя', 'Новая']);
    const filtered = await get(`/api/expenses?cards=${encodeURIComponent('Новая')}`, 'misha');
    expect(filtered.json().data.items).toHaveLength(1);
  });
});
