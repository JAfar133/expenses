import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Management of a group by its owner and by the application administrator; invitations. */
let database: Database;
let t: TestApp;
let clock: number;

const PASSWORD = 'a-long-enough-password';
const rows = <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params);
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
) =>
  t.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) }, as);
const anonymous = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({
    method,
    url,
    headers: { origin: TEST_ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const cardId = async (name: string) =>
  (await rows<{ id: string }>('SELECT id FROM cards WHERE name = $1', [name]))[0]!.id;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  clock = Date.parse('2026-10-11T12:00:00Z');
  t = await createTestApp(database, { now: () => new Date(clock) });
});

describe('группа: просмотр и права', () => {
  it('владелец видит участников, карты с доступом, категории и приглашения', async () => {
    const response = await call('GET', '/api/group', 'misha');

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.group).toMatchObject({ name: 'Семья', reportingCurrency: 'AMD' });
    expect(
      data.members.map((m: { username: string; role: string }) => [m.username, m.role]),
    ).toEqual([
      ['misha', 'owner'],
      ['nastya', 'member'],
    ]);
    expect(data.cards.map((c: { name: string }) => c.name)).toEqual(['Миша', 'Настя']);
    expect(data.cards[0].access).toHaveLength(1);
    expect(data.categories.map((c: { name: string }) => c.name)).toEqual(['кафе', 'продукты']);
    expect(data.invitations).toEqual([]);
  });

  it('участнику все эти маршруты закрыты (403)', async () => {
    const id = await cardId('Миша');
    for (const [method, url, payload] of [
      ['GET', '/api/group'],
      ['PATCH', '/api/group', { name: 'x' }],
      ['POST', '/api/group/cards', { name: 'x' }],
      ['PATCH', `/api/group/cards/${id}`, { name: 'x' }],
      ['PUT', `/api/group/cards/${id}/access`, { access: {} }],
      ['POST', '/api/group/categories', { name: 'x' }],
      ['POST', '/api/group/invitations', { role: 'member' }],
      ['DELETE', '/api/group/members/misha'],
    ] as const) {
      expect((await call(method, url, 'nastya', payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('переименование группы', async () => {
    await call('PATCH', '/api/group', 'misha', { name: '  Наш дом ' });

    expect((await call('GET', '/api/group', 'misha')).json().data.group.name).toBe('Наш дом');
    expect((await call('PATCH', '/api/group', 'misha', { name: '  ' })).statusCode).toBe(422);
  });
});

describe('карты', () => {
  it('создание: без доступа участников, имя уникально в группе', async () => {
    const created = await call('POST', '/api/group/cards', 'misha', { name: 'Общая' });

    expect(created.statusCode).toBe(201);
    expect((await call('GET', '/api/cards', 'nastya')).json().data).toEqual(['Миша', 'Настя']);
    expect((await call('GET', '/api/cards', 'misha')).json().data).toContain('Общая');
    const again = await call('POST', '/api/group/cards', 'misha', { name: 'Общая' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NAME_TAKEN');
  });

  it('переименование меняет название везде, включая уже сделанные траты', async () => {
    await new PostgresExpenseRepository(database).insertPending(
      database,
      { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 100 },
      'misha',
    );
    const id = await cardId('Миша');

    const response = await call('PATCH', `/api/group/cards/${id}`, 'misha', { name: 'Зарплатная' });

    expect(response.statusCode).toBe(200);
    expect((await call('GET', '/api/cards', 'misha')).json().data).toEqual(['Зарплатная', 'Настя']);
    const list = (await call('GET', '/api/expenses?limit=10', 'misha')).json().data.items;
    expect(list.map((i: { card: string }) => i.card)).toEqual(['Зарплатная']);
    expect((await rows('SELECT card FROM expenses'))[0]).toEqual({ card: 'Зарплатная' });
  });

  it('нельзя назвать карту так же, как другую', async () => {
    const id = await cardId('Миша');

    expect(
      (await call('PATCH', `/api/group/cards/${id}`, 'misha', { name: 'Настя' })).statusCode,
    ).toBe(409);
  });

  it('архив убирает карту из формы, возврат возвращает', async () => {
    const id = await cardId('Настя');

    await call('PATCH', `/api/group/cards/${id}`, 'misha', { archived: true });
    expect((await call('GET', '/api/cards', 'misha')).json().data).toEqual(['Миша']);
    await call('PATCH', `/api/group/cards/${id}`, 'misha', { archived: false });
    expect((await call('GET', '/api/cards', 'misha')).json().data).toEqual(['Миша', 'Настя']);
  });

  it('доступ участника: выдать, сузить до просмотра, забрать', async () => {
    const id = await cardId('Настя');
    const cardsOfNastya = async () => (await call('GET', '/api/cards', 'nastya')).json().data;
    expect(await cardsOfNastya()).toEqual(['Миша', 'Настя']);

    await call('PUT', `/api/group/cards/${id}/access`, 'misha', { access: { nastya: 'view' } });
    expect(await cardsOfNastya()).toEqual(['Миша']);

    await call('PUT', `/api/group/cards/${id}/access`, 'misha', { access: {} });
    const expensesVisible = (await call('GET', '/api/expenses', 'nastya')).json().data.total;
    expect(expensesVisible).toBe(0);

    await call('PUT', `/api/group/cards/${id}/access`, 'misha', { access: { nastya: 'edit' } });
    expect(await cardsOfNastya()).toEqual(['Миша', 'Настя']);
  });

  it('доступ: неизвестный участник и неверный уровень отклоняются', async () => {
    const id = await cardId('Настя');

    expect(
      (await call('PUT', `/api/group/cards/${id}/access`, 'misha', { access: { ghost: 'edit' } }))
        .statusCode,
    ).toBe(422);
    expect(
      (await call('PUT', `/api/group/cards/${id}/access`, 'misha', { access: { nastya: 'admin' } }))
        .statusCode,
    ).toBe(422);
  });

  it('чужую карту трогать нельзя (404)', async () => {
    const [other] = await rows<{ id: string }>(
      "INSERT INTO groups (name, reporting_currency, timezone) VALUES ('B', 'AMD', 'UTC') RETURNING id",
    );
    const [card] = await rows<{ id: string }>(
      "INSERT INTO cards (group_id, name, currency) VALUES ($1, 'Чужая', 'AMD') RETURNING id",
      [other!.id],
    );

    expect(
      (await call('PATCH', `/api/group/cards/${card!.id}`, 'misha', { name: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (await call('PUT', `/api/group/cards/${card!.id}/access`, 'misha', { access: {} }))
        .statusCode,
    ).toBe(404);
  });
});

describe('категории', () => {
  it('создание, дубль, переименование (в уже сделанных тратах тоже), архив', async () => {
    await new PostgresExpenseRepository(database).insertPending(
      database,
      { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 100 },
      'misha',
    );

    const created = await call('POST', '/api/group/categories', 'misha', { name: 'спорт' });
    expect(created.statusCode).toBe(201);
    expect(
      (await call('POST', '/api/group/categories', 'misha', { name: 'спорт' })).statusCode,
    ).toBe(409);

    const [cafe] = await rows<{ id: string }>("SELECT id FROM categories WHERE name = 'кафе'");
    await call('PATCH', `/api/group/categories/${cafe!.id}`, 'misha', { name: 'рестораны' });
    expect((await call('GET', '/api/categories', 'misha')).json().data).toEqual([
      'рестораны',
      'продукты',
      'спорт',
    ]);
    expect((await rows('SELECT category FROM expenses'))[0]).toEqual({ category: 'рестораны' });

    await call('PATCH', `/api/group/categories/${cafe!.id}`, 'misha', { archived: true });
    expect((await call('GET', '/api/categories', 'nastya')).json().data).not.toContain('рестораны');
  });
});

describe('приглашения', () => {
  const invite = async (role = 'member') =>
    (await call('POST', '/api/group/invitations', 'misha', { role })).json().data.token as string;
  const accept = (token: string, body: object = {}) =>
    anonymous('POST', `/api/invitations/${token}/accept`, {
      username: 'olya',
      displayName: 'Оля',
      password: PASSWORD,
      ...body,
    });

  it('ссылка открывается без входа и показывает группу и роль', async () => {
    const token = await invite('member');

    const preview = await anonymous('GET', `/api/invitations/${token}`);

    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toEqual({
      kind: 'join',
      groupName: 'Семья',
      role: 'member',
      username: null,
    });
  });

  it('приняв приглашение, человек получает аккаунт, группу, доступ ко всем картам и вход', async () => {
    const response = await accept(await invite());

    expect(response.statusCode).toBe(201);
    expect(response.headers['set-cookie']).toBeTruthy();
    const [user] = await rows<{ card: string; from_env: boolean; display_name: string }>(
      "SELECT card, from_env, display_name FROM users WHERE username = 'olya'",
    );
    expect(user).toEqual({ card: 'Миша', from_env: false, display_name: 'Оля' });
    const access = await rows(
      "SELECT 1 FROM card_access a JOIN users u ON u.id = a.user_id WHERE u.username = 'olya' AND a.level = 'edit'",
    );
    expect(access).toHaveLength(2);
    expect((await call('GET', '/api/cards', 'olya')).json().data).toEqual(['Миша', 'Настя']);
    expect((await call('GET', '/api/group', 'olya')).statusCode).toBe(403);
  });

  it('ссылка одноразовая', async () => {
    const token = await invite();
    await accept(token);

    const again = await accept(token, { username: 'petr' });

    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('INVITATION_INVALID');
    expect((await anonymous('GET', `/api/invitations/${token}`)).statusCode).toBe(404);
  });

  it('просроченная и отозванная ссылки не работают', async () => {
    const expired = await invite();
    clock += 8 * 86_400_000;
    expect((await accept(expired)).statusCode).toBe(404);

    clock = Date.parse('2026-10-11T12:00:00Z');
    const revoked = await invite();
    const [pending] = await rows<{ id: string }>(
      'SELECT id FROM invitations WHERE revoked_at IS NULL AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
    );
    expect(
      (await call('DELETE', `/api/group/invitations/${pending!.id}`, 'misha')).statusCode,
    ).toBe(200);
    expect((await accept(revoked)).statusCode).toBe(404);
  });

  it('неверные данные: логин, имя, короткий пароль, занятый логин', async () => {
    const token = await invite();

    expect((await accept(token, { username: 'A B' })).json().error.code).toBe('INVALID_USERNAME');
    expect((await accept(token, { displayName: '' })).json().error.code).toBe('INVALID_NAME');
    expect((await accept(token, { password: 'short' })).json().error.code).toBe('WEAK_PASSWORD');
    expect((await accept(token, { username: 'misha' })).json().error.code).toBe('USERNAME_TAKEN');
    // Failed attempts do not spend the invitation
    expect((await accept(token)).statusCode).toBe(201);
  });

  it('список ожидающих приглашений в группе, токен в нём не отдаётся', async () => {
    const token = await invite('owner');

    const list = (await call('GET', '/api/group', 'misha')).json().data.invitations;

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'join', role: 'owner' });
    expect(JSON.stringify(list)).not.toContain(token);
  });

  it('в базе нет самого токена, только хеш', async () => {
    const token = await invite();

    expect(JSON.stringify(await rows('SELECT * FROM invitations'))).not.toContain(token);
  });
});

describe('сброс пароля и участники', () => {
  it('владелец выдаёт ссылку сброса: новый пароль работает, старые сессии закрыты', async () => {
    const link = (await call('POST', '/api/group/members/nastya/reset-password', 'misha')).json()
      .data;
    expect((await call('GET', '/api/cards', 'nastya')).statusCode).toBe(200);

    const preview = await anonymous('GET', `/api/invitations/${link.token}`);
    expect(preview.json().data).toMatchObject({ kind: 'reset', username: 'nastya' });
    const done = await anonymous('POST', `/api/invitations/${link.token}/accept`, {
      password: 'brand-new-password-1',
    });

    expect(done.statusCode).toBe(201);
    const login = await anonymous('POST', '/api/auth/login', {
      username: 'nastya',
      password: 'brand-new-password-1',
    });
    expect(login.statusCode).toBe(200);
    // The session opened before the reset was closed (the helper's cookies are no longer valid)
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/cards',
          cookies: await t.sessionCookies('nastya'),
        })
      ).statusCode,
    ).toBe(200);
  });

  it('себе сброс и удаление нельзя; неизвестному 404', async () => {
    expect(
      (await call('POST', '/api/group/members/misha/reset-password', 'misha')).statusCode,
    ).toBe(422);
    expect((await call('DELETE', '/api/group/members/misha', 'misha')).statusCode).toBe(422);
    expect((await call('DELETE', '/api/group/members/ghost', 'misha')).statusCode).toBe(404);
  });

  it('пользователя из настроек сервера убрать нельзя', async () => {
    const response = await call('DELETE', '/api/group/members/nastya', 'misha');

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('MANAGED_BY_SETTINGS');
  });

  it('приглашённого можно убрать: вход закрыт, его траты остаются', async () => {
    const token = (await call('POST', '/api/group/invitations', 'misha', { role: 'member' })).json()
      .data.token;
    await anonymous('POST', `/api/invitations/${token}/accept`, {
      username: 'olya',
      displayName: 'Оля',
      password: PASSWORD,
    });
    await new PostgresExpenseRepository(database).insertPending(
      database,
      { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Оля-кофе', amount: 5 },
      'olya',
    );

    expect((await call('DELETE', '/api/group/members/olya', 'misha')).statusCode).toBe(200);

    expect(
      (await anonymous('POST', '/api/auth/login', { username: 'olya', password: PASSWORD }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call('GET', '/api/group', 'misha'))
        .json()
        .data.members.map((m: { username: string }) => m.username),
    ).toEqual(['misha', 'nastya']);
    expect(await rows("SELECT 1 FROM expenses WHERE name = 'Оля-кофе'")).toHaveLength(1);
  });

  it('роль: выдать и забрать, последнего владельца оставить', async () => {
    expect(
      (await call('PUT', '/api/group/members/nastya/role', 'misha', { role: 'owner' })).statusCode,
    ).toBe(200);
    expect((await call('GET', '/api/group', 'nastya')).statusCode).toBe(200);
    expect(
      (await call('PUT', '/api/group/members/misha/role', 'nastya', { role: 'member' })).statusCode,
    ).toBe(200);
    const last = await call('PUT', '/api/group/members/nastya/role', 'nastya', { role: 'member' });
    expect(last.statusCode).toBe(409);
  });

  it('синхронизация пользователей с настройками не отключает приглашённых', async () => {
    const token = (await call('POST', '/api/group/invitations', 'misha', { role: 'member' })).json()
      .data.token;
    await anonymous('POST', `/api/invitations/${token}/accept`, {
      username: 'olya',
      displayName: 'Оля',
      password: PASSWORD,
    });

    await t.auth.syncUsers(
      [
        { username: 'misha', card: 'Миша' },
        { username: 'nastya', card: 'Настя' },
      ],
      new Map(),
    );

    expect((await rows("SELECT disabled_at FROM users WHERE username = 'olya'"))[0]).toEqual({
      disabled_at: null,
    });
  });
});

describe('администратор приложения', () => {
  const createGroup = (as = 'misha', body: object = { name: 'Группа Ольги' }) =>
    call('POST', '/api/admin/groups', as, body);

  it('маршруты только для администратора', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/admin/groups'],
      ['POST', '/api/admin/groups', { name: 'x' }],
      ['POST', '/api/admin/users/misha/reset-password'],
    ] as const) {
      expect((await call(method, url, 'nastya', payload)).statusCode, url).toBe(403);
    }
  });

  it('создаёт группу и ссылку для владельца; владелец получает карту со своим именем', async () => {
    const created = await createGroup();
    expect(created.statusCode).toBe(201);

    const token = created.json().data.token;
    const accepted = await anonymous('POST', `/api/invitations/${token}/accept`, {
      username: 'olga',
      displayName: 'Ольга',
      password: PASSWORD,
    });

    expect(accepted.statusCode).toBe(201);
    const view = (await call('GET', '/api/group', 'olga')).json().data;
    expect(view.group.name).toBe('Группа Ольги');
    expect(view.cards.map((c: { name: string }) => c.name)).toEqual(['Ольга']);
    expect(view.categories.map((c: { name: string }) => c.name)).toEqual(['кафе', 'продукты']);
    // The groups do not see each other
    expect((await call('GET', '/api/group', 'misha')).json().data.group.name).toBe('Семья');
    const list = (await call('GET', '/api/admin/groups', 'misha')).json().data;
    expect(
      list.map((g: { name: string; owners: number; members: number }) => [
        g.name,
        g.owners,
        g.members,
      ]),
    ).toEqual([
      ['Семья', 1, 2],
      ['Группа Ольги', 1, 1],
    ]);
  });

  it('администратор не видит траты чужих групп', async () => {
    await createGroup();
    await new PostgresExpenseRepository(database).insertPending(
      database,
      { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 100 },
      'misha',
    );
    const token = (await createGroup('misha', { name: 'Другая' })).json().data.token;
    await anonymous('POST', `/api/invitations/${token}/accept`, {
      username: 'olga',
      displayName: 'Ольга',
      password: PASSWORD,
    });

    expect((await call('GET', '/api/expenses', 'olga')).json().data.total).toBe(0);
  });

  it('неверные данные группы', async () => {
    expect((await createGroup('misha', { name: '' })).statusCode).toBe(422);
    expect((await createGroup('misha', { name: 'x', currency: 'XXX' })).json().error.code).toBe(
      'INVALID_CURRENCY',
    );
    expect(
      (await createGroup('misha', { name: 'x', timezone: 'Mars/Base' })).json().error.code,
    ).toBe('INVALID_TIMEZONE');
  });

  it('отключённая группа: участники ничего не видят и не добавляют; включение возвращает', async () => {
    const [group] = await rows<{ id: string }>('SELECT id FROM groups');

    expect(
      (await call('PATCH', `/api/admin/groups/${group!.id}`, 'misha', { disabled: true }))
        .statusCode,
    ).toBe(200);
    expect((await call('GET', '/api/cards', 'nastya')).json().data).toEqual([]);
    expect((await call('GET', '/api/expenses', 'nastya')).json().data.total).toBe(0);

    await call('PATCH', `/api/admin/groups/${group!.id}`, 'misha', { disabled: false });
    expect((await call('GET', '/api/cards', 'nastya')).json().data).toEqual(['Миша', 'Настя']);
  });

  it('новая ссылка владельцу и сброс пароля любому пользователю', async () => {
    const [group] = await rows<{ id: string }>('SELECT id FROM groups');

    const owner = await call('POST', `/api/admin/groups/${group!.id}/owner-invitations`, 'misha');
    expect(owner.statusCode).toBe(201);
    const reset = await call('POST', '/api/admin/users/nastya/reset-password', 'misha');
    expect(reset.statusCode).toBe(201);
    expect((await call('POST', '/api/admin/users/ghost/reset-password', 'misha')).statusCode).toBe(
      404,
    );
  });
});
