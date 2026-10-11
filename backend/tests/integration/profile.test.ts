import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { AuthRepository } from '../../src/modules/auth/auth.repository.ts';
import { AuthService } from '../../src/modules/auth/auth.service.ts';
import { AnalyticsRepository } from '../../src/modules/analytics/analytics.repository.ts';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM auth_sessions');
  t = await createTestApp(database);
  await database.query(
    'UPDATE users SET custom_display_name = NULL, custom_card = NULL, custom_timezone = NULL, can_edit_override = NULL',
  );
});

type Who = 'misha' | 'nastya';
const patch = (payload: unknown, as: Who = 'misha') =>
  t.inject({ method: 'PATCH', url: '/api/auth/profile', payload: payload as object }, as);
const me = async (as: Who = 'misha') =>
  (await t.inject({ method: 'GET', url: '/api/auth/me' }, as)).json().data.user;
const users = (as: Who = 'misha') => t.inject({ method: 'GET', url: '/api/users' }, as);
const rights = (username: string, canEdit: unknown, as: Who = 'misha') =>
  t.inject(
    { method: 'PUT', url: `/api/users/${username}/rights`, payload: { canEdit } as object },
    as,
  );

describe('профиль: имя, карта, часовой пояс', () => {
  it('значения по умолчанию из конфигурации', async () => {
    expect(await me()).toEqual({
      username: 'misha',
      displayName: 'Миша',
      card: 'Миша',
      canEdit: true,
      timezone: 'Asia/Yerevan',
    });
  });

  it('сохраняется и сразу видно в /api/auth/me; логин не меняется', async () => {
    const response = await patch({
      displayName: '  Михаил ',
      card: 'Настя',
      timezone: 'Europe/Moscow',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user).toMatchObject({
      username: 'misha',
      displayName: 'Михаил',
      card: 'Настя',
      timezone: 'Europe/Moscow',
    });
    expect(await me()).toMatchObject({
      username: 'misha',
      displayName: 'Михаил',
      card: 'Настя',
      timezone: 'Europe/Moscow',
    });
  });

  it('можно менять поля по отдельности: остальные остаются', async () => {
    await patch({ displayName: 'Михаил' });
    await patch({ timezone: 'Europe/Moscow' });

    expect(await me()).toMatchObject({
      displayName: 'Михаил',
      card: 'Миша',
      timezone: 'Europe/Moscow',
    });
  });

  it('у каждого пользователя свои настройки', async () => {
    await patch({ displayName: 'Михаил', timezone: 'Europe/Moscow' }, 'misha');

    expect(await me('nastya')).toMatchObject({ displayName: 'Настя', timezone: 'Asia/Yerevan' });
  });

  it('null возвращает значение по умолчанию', async () => {
    await patch({ displayName: 'Михаил', card: 'Настя', timezone: 'Europe/Moscow' });

    await patch({ displayName: null, card: null, timezone: null });

    expect(await me()).toMatchObject({
      displayName: 'Миша',
      card: 'Миша',
      timezone: 'Asia/Yerevan',
    });
  });

  it('ответ не содержит служебных полей (хеши паролей, идентификатор)', async () => {
    const body = (await patch({ displayName: 'Михаил' })).body;

    expect(body).not.toMatch(/hash|scrypt|"id"/i);
  });

  it.each([
    ['пустое имя', { displayName: '   ' }],
    ['слишком длинное имя', { displayName: 'я'.repeat(41) }],
    ['карта не из списка', { card: 'Вася' }],
    ['неизвестный часовой пояс', { timezone: 'Mars/Phobos' }],
    ['часовой пояс не строка', { timezone: 5 }],
    ['слишком длинный часовой пояс', { timezone: 'A'.repeat(65) }],
    ['неизвестное поле (логин менять нельзя)', { username: 'ivan' }],
    ['поле не того типа', { displayName: 5 }],
    ['ничего не указано', {}],
  ])('%s: 422, профиль не меняется', async (_title, payload) => {
    const response = await patch(payload);

    expect(response.statusCode).toBe(422);
    expect(['INVALID_PROFILE', 'NOTHING_TO_UPDATE']).toContain(response.json().error.code);
    expect(await me()).toMatchObject({
      displayName: 'Миша',
      card: 'Миша',
      timezone: 'Asia/Yerevan',
    });
  });

  it('допустимые часовые пояса: именованные и UTC', async () => {
    for (const timezone of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
      expect((await patch({ timezone })).statusCode).toBe(200);
    }
  });

  it('без входа 401', async () => {
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: '/api/auth/profile',
          payload: { displayName: 'x' },
          headers: { origin: 'http://localhost' },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('личный выбор и конфигурация при перезапуске', () => {
  const restart = async (
    users: { username: string; card: string }[],
    defaults: { editors?: string[]; timezone?: string },
  ) => {
    const auth = new AuthService({
      repository: new AuthRepository(database),
      config: {
        accessTtlMs: 1,
        refreshTtlMs: 1,
        sessionMaxMs: 1,
        rotationGraceMs: 1,
        minPasswordLength: 8,
      },
    });
    await auth.syncUsers(users, new Map(), defaults);
  };
  const USERS = [
    { username: 'misha', card: 'Миша' },
    { username: 'nastya', card: 'Настя' },
  ];

  it('личные имя, карта и часовой пояс переживают перезапуск с другими значениями в конфигурации', async () => {
    await patch({ displayName: 'Михаил', card: 'Настя', timezone: 'Europe/Moscow' });

    await restart([{ username: 'misha', card: 'Миша' }, USERS[1]!], {
      editors: ['misha'],
      timezone: 'Asia/Tbilisi',
    });

    expect(await me()).toMatchObject({
      displayName: 'Михаил',
      card: 'Настя',
      timezone: 'Europe/Moscow',
    });
  });

  it('а значения по умолчанию обновляются из конфигурации', async () => {
    await restart(USERS, { editors: ['misha'], timezone: 'Asia/Tbilisi' });

    expect(await me('nastya')).toMatchObject({ timezone: 'Asia/Tbilisi' });
  });

  it('если сбросить личный выбор, действует новое значение из конфигурации', async () => {
    await patch({ timezone: 'Europe/Moscow' });
    await restart(USERS, { editors: ['misha'], timezone: 'Asia/Tbilisi' });

    await patch({ timezone: null });

    expect(await me()).toMatchObject({ timezone: 'Asia/Tbilisi' });
  });
});

describe('права на правку и удаление', () => {
  it('список пользователей виден только редакторам', async () => {
    const allowed = await users('misha');
    const denied = await users('nastya');

    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data).toEqual([
      { username: 'misha', displayName: 'Миша', canEdit: true },
      { username: 'nastya', displayName: 'Настя', canEdit: false },
    ]);
    expect(denied.statusCode).toBe(403);
  });

  it('редактор даёт право другому: тот сразу может править записи', async () => {
    const repository = new PostgresExpenseRepository(database);
    const created = await repository.insertPending(
      database,
      { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 100 },
      'misha',
    );
    const edit = () =>
      t.inject(
        { method: 'PATCH', url: `/api/expenses/${created.id}`, payload: { amount: 5 } },
        'nastya',
      );
    expect((await edit()).statusCode).toBe(403);

    const granted = await rights('nastya', true);

    expect(granted.statusCode).toBe(200);
    expect(granted.json().data).toEqual({ username: 'nastya', canEdit: true });
    expect((await me('nastya')).canEdit).toBe(true);
    expect((await edit()).statusCode).toBe(200);
  });

  it('право можно забрать, пока есть другой редактор', async () => {
    await rights('nastya', true);

    const response = await rights('misha', false, 'nastya');

    expect(response.statusCode).toBe(200);
    expect((await me('misha')).canEdit).toBe(false);
  });

  it('последнего редактора лишить права нельзя', async () => {
    const response = await rights('misha', false);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LAST_EDITOR');
    expect((await me('misha')).canEdit).toBe(true);
  });

  it('не редактор не может менять права, в том числе себе', async () => {
    for (const response of [
      await rights('nastya', true, 'nastya'),
      await rights('misha', false, 'nastya'),
    ]) {
      expect(response.statusCode).toBe(403);
    }
    expect((await me('nastya')).canEdit).toBe(false);
  });

  it('неизвестный пользователь: 404; неверное тело: 422', async () => {
    expect((await rights('ivan', true)).statusCode).toBe(404);
    for (const payload of ['да', 1, null, undefined]) {
      expect((await rights('nastya', payload)).statusCode).toBe(422);
    }
    expect(
      (
        await t.inject(
          {
            method: 'PUT',
            url: '/api/users/nastya/rights',
            payload: { canEdit: true, admin: true },
          },
          'misha',
        )
      ).statusCode,
    ).toBe(422);
  });

  it('выбранное право переживает перезапуск с другим EDITOR_USERS', async () => {
    await rights('nastya', true);
    const auth = new AuthService({
      repository: new AuthRepository(database),
      config: {
        accessTtlMs: 1,
        refreshTtlMs: 1,
        sessionMaxMs: 1,
        rotationGraceMs: 1,
        minPasswordLength: 8,
      },
    });

    await auth.syncUsers(
      [
        { username: 'misha', card: 'Миша' },
        { username: 'nastya', card: 'Настя' },
      ],
      new Map(),
      { editors: ['misha'], timezone: 'Asia/Yerevan' },
    );

    expect((await me('nastya')).canEdit).toBe(true);
  });

  it('без входа 401', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(401);
  });
});

describe('часовой пояс в аналитике', () => {
  it('«сегодня» определяется по часовому поясу пользователя', async () => {
    const service = new AnalyticsService({
      repository: new AnalyticsRepository(database, 'AMD'),
      // 15 октября по Еревану, ещё 14-е по Нью-Йорку
      today: (timezone) => (timezone === 'America/New_York' ? '2026-10-14' : '2026-10-15'),
    });
    const filters = {
      from: '2026-10-01',
      to: '2026-10-31',
      cards: [],
      categories: [],
      createdBy: [],
      currencies: [],
      includeDeleted: false,
    };

    const yerevan = await service.summary(filters, 'Asia/Yerevan');
    const newYork = await service.summary(filters, 'America/New_York');

    expect(yerevan.current.days).toBe(15);
    expect(newYork.current.days).toBe(14);
    expect(await service.timeseries(filters, 'day', undefined, 'America/New_York')).toHaveLength(
      14,
    );
    expect(await service.timeseries(filters, 'day', undefined, 'Asia/Yerevan')).toHaveLength(15);
  });
});
