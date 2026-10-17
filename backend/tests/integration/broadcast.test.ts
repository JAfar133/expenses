import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Messages from the owner (to their group) and the administrator (to everyone) through the bell and Web Push. */
let database: Database;
let t: TestApp;

const KEYS = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
) =>
  t.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) }, as);
const idOf = async (username: string) =>
  (await database.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]))[0]!
    .id;
const feed = async (as: string) =>
  (await call('GET', '/api/notifications', as)).json().data as {
    items: { type: string; title: string; body: string; data: { senderName?: string } | null }[];
    unread: number;
  };
const send = (as: string, payload: unknown) =>
  call('POST', '/api/notifications/broadcast', as, payload);

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM notification_broadcasts; DELETE FROM push_subscriptions; DELETE FROM notification_settings; DELETE FROM notifications; DELETE FROM import_log; DELETE FROM bank_imports; DELETE FROM api_keys; DELETE FROM template_order; DELETE FROM template_hidden; DELETE FROM expense_templates; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  // misha is the owner of the group and the administrator; the tests below change that when they need to
  await t.authRepository.upsertUser('outsider', 'Чужой', { timezone: 'Asia/Yerevan' });
});

const stopBeingAdmin = () =>
  database.query("UPDATE users SET is_admin = false WHERE username = 'misha'");

describe('владелец группы пишет участникам своей группы', () => {
  beforeEach(stopBeingAdmin);

  it('сообщение приходит участнику в колокольчик (с именем отправителя), отправителю не приходит', async () => {
    const response = await send('misha', {
      text: 'Завтра платим за квартиру',
      audience: { type: 'group' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.recipients).toBe(1);
    const member = await feed('nastya');
    expect(member.unread).toBe(1);
    expect(member.items[0]).toMatchObject({
      type: 'announcement',
      title: expect.stringContaining('Сообщение ·'),
      body: 'Завтра платим за квартиру',
    });
    expect(member.items[0]!.data?.senderName).toEqual(expect.any(String));
    expect((await feed('misha')).items).toHaveLength(0);
  });

  it('своя тема сообщения; участник получает ещё и push, если у него есть устройство', async () => {
    await call('POST', '/api/push/subscriptions', 'nastya', {
      endpoint: endpoint('n1'),
      keys: KEYS,
    });

    await send('misha', { title: 'Важно', text: 'Проверьте карту', audience: { type: 'group' } });
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(1);
    expect(t.pushSender.sent[0]!.payload).toMatchObject({
      type: 'announcement',
      title: 'Важно',
      body: 'Проверьте карту',
    });
  });

  it('в приватном режиме сообщение всё равно читается (это не финансовые данные)', async () => {
    await call('POST', '/api/push/subscriptions', 'nastya', {
      endpoint: endpoint('n1'),
      keys: KEYS,
    });
    await call('PUT', '/api/notifications/settings', 'nastya', { push: { hideAmounts: true } });

    await send('misha', { text: 'Привет', audience: { type: 'group' } });
    await t.push.flush();

    expect(t.pushSender.sent[0]!.payload.body).toBe('Привет');
  });

  it('человек может отключить push от сообщений, лента остаётся', async () => {
    await call('POST', '/api/push/subscriptions', 'nastya', {
      endpoint: endpoint('n1'),
      keys: KEYS,
    });
    await call('PUT', '/api/notifications/settings', 'nastya', {
      push: { types: { announcement: false } },
    });

    await send('misha', { text: 'Привет', audience: { type: 'group' } });
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(0);
    expect((await feed('nastya')).items).toHaveLength(1);
  });

  it('выбрать получателей можно только из своей группы; «всем» владельцу нельзя', async () => {
    const outsider = await idOf('outsider');

    const outside = await send('misha', {
      text: 'Привет',
      audience: { type: 'users', userIds: [outsider] },
    });
    const all = await send('misha', { text: 'Привет', audience: { type: 'all' } });

    expect(outside.statusCode).toBe(422);
    expect(all.statusCode).toBe(403);
    expect((await feed('outsider')).items).toHaveLength(0);
  });

  it('список адресатов: только участники своей группы, без себя', async () => {
    const response = (await call('GET', '/api/notifications/recipients', 'misha')).json().data;

    expect(response.canSendToAll).toBe(false);
    expect(response.users.map((user: { name: string }) => user.name)).toEqual([expect.any(String)]);
    expect(response.users).toHaveLength(1);
  });

  it('отправленное видно в истории отправителя', async () => {
    await send('misha', { text: 'Первое', audience: { type: 'group' } });
    await send('misha', { text: 'Второе', audience: { type: 'group' } });

    const history = (await call('GET', '/api/notifications/broadcasts', 'misha')).json().data;

    expect(history.map((item: { body: string }) => item.body)).toEqual(['Второе', 'Первое']);
    expect(history[0]).toMatchObject({ scope: 'group', recipients: 1 });
    expect((await call('GET', '/api/notifications/broadcasts', 'nastya')).statusCode).toBe(403);
  });
});

describe('участник не может писать', () => {
  it('ни отправлять, ни смотреть список адресатов и историю: 403', async () => {
    await stopBeingAdmin();

    expect((await send('nastya', { text: 'Привет', audience: { type: 'group' } })).statusCode).toBe(
      403,
    );
    expect((await call('GET', '/api/notifications/recipients', 'nastya')).statusCode).toBe(403);
    expect((await call('GET', '/api/notifications/broadcasts', 'nastya')).statusCode).toBe(403);
    expect((await feed('misha')).items).toHaveLength(0);
  });
});

describe('администратор пишет всем', () => {
  it('«всем» доходит до всех, в том числе до человека без группы; отправителю нет', async () => {
    const response = await send('misha', {
      text: 'Плановые работы ночью',
      audience: { type: 'all' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.recipients).toBe(2);
    expect((await feed('nastya')).items[0]).toMatchObject({ type: 'announcement' });
    expect((await feed('outsider')).items[0]).toMatchObject({ type: 'announcement' });
    expect((await feed('misha')).items).toHaveLength(0);
  });

  it('можно выбрать нескольких людей из любых групп', async () => {
    const outsider = await idOf('outsider');

    const response = await send('misha', {
      text: 'Тебе',
      audience: { type: 'users', userIds: [outsider] },
    });

    expect(response.json().data.recipients).toBe(1);
    expect((await feed('outsider')).items).toHaveLength(1);
    expect((await feed('nastya')).items).toHaveLength(0);
  });

  it('список адресатов для администратора: все активные пользователи, можно писать всем', async () => {
    const data = (await call('GET', '/api/notifications/recipients', 'misha')).json().data;

    expect(data.canSendToAll).toBe(true);
    expect(data.users).toHaveLength(2);
  });

  it('отключённый пользователь сообщений не получает', async () => {
    await database.query("UPDATE users SET disabled_at = now() WHERE username = 'outsider'");

    const response = await send('misha', { text: 'Всем', audience: { type: 'all' } });

    expect(response.json().data.recipients).toBe(1);
  });
});

describe('проверка запроса', () => {
  beforeEach(stopBeingAdmin);

  it('пустой или слишком длинный текст, слишком длинная тема, неверный выбор получателей', async () => {
    const audience = { type: 'group' };

    expect((await send('misha', { text: '   ', audience })).statusCode).toBe(422);
    expect((await send('misha', { text: 'x'.repeat(301), audience })).statusCode).toBe(422);
    expect((await send('misha', { text: 'ok', title: 'x'.repeat(81), audience })).statusCode).toBe(
      422,
    );
    expect((await send('misha', { text: 'ok' })).statusCode).toBe(422);
    expect(
      (await send('misha', { text: 'ok', audience: { type: 'users', userIds: [] } })).statusCode,
    ).toBe(422);
    expect(
      (await send('misha', { text: 'ok', audience: { type: 'users', userIds: ['не id'] } }))
        .statusCode,
    ).toBe(422);
  });

  it('не больше десяти сообщений в час от одного человека', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      statuses.push(
        (await send('misha', { text: `Сообщение ${index}`, audience: { type: 'group' } }))
          .statusCode,
      );
    }

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('без входа нельзя', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/notifications/recipients' });

    expect(response.statusCode).toBe(401);
  });
});
