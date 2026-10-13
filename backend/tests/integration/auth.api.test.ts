import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.ts';
import {
  createTestApp,
  TEST_ORIGIN,
  TEST_PASSWORD,
  type TestApp,
} from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM expenses');
  await database.query('DELETE FROM idempotency_keys');
  await database.query('DELETE FROM auth_sessions');
  t = await createTestApp(database);
});

const json = { 'content-type': 'application/json' };
const body = (payload: object) => JSON.stringify(payload);

/** Login by username and password: returns the response and the cookies set by the server. */
async function login(
  username = 'misha',
  password = TEST_PASSWORD,
  extra: { headers?: Record<string, string>; remoteAddress?: string } = {},
) {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { ...json, origin: TEST_ORIGIN, ...extra.headers },
    remoteAddress: extra.remoteAddress,
    payload: body({ username, password }),
  });
  return { response, cookies: cookiesOf(response) };
}

const cookiesOf = (response: LightMyRequestResponse) =>
  Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));

const cookie = (response: LightMyRequestResponse, name: string) =>
  response.cookies.find((c) => c.name === name)!;

/** A request with the given cookies and the Origin of our site. */
const authed = (cookies: Record<string, string>, options: InjectOptions) =>
  t.app.inject({ ...options, cookies, headers: { origin: TEST_ORIGIN, ...options.headers } });

describe('POST /api/auth/login', () => {
  it('вход по верному паролю: пользователь, карта по умолчанию и куки', async () => {
    const { response } = await login('nastya');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        user: {
          username: 'nastya',
          displayName: 'Настя',
          card: 'Настя',
          canEdit: false,
          timezone: 'Asia/Yerevan',
          defaultTimezone: 'Asia/Yerevan',
          role: 'member',
          isAdmin: false,
        },
      },
    });
  });

  it('карта по умолчанию зависит от пользователя', async () => {
    expect((await login('misha')).response.json().data.user.card).toBe('Миша');
    expect((await login('nastya')).response.json().data.user.card).toBe('Настя');
  });

  it('access-кука: HttpOnly, SameSite=Lax, путь /api, срок 24 часа', async () => {
    const { response } = await login();
    const access = cookie(response, 'et_access');

    expect(access).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api' });
    expect(access.secure).toBeFalsy();
    const lifetimeHours = (new Date(access.expires!).getTime() - Date.now()) / 3_600_000;
    expect(lifetimeHours).toBeGreaterThan(23.9);
    expect(lifetimeHours).toBeLessThan(24.1);
  });

  it('refresh-кука: HttpOnly, SameSite=Lax, путь /api/auth, срок 7 дней', async () => {
    const { response } = await login();
    const refresh = cookie(response, 'et_refresh');

    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth' });
    const lifetimeDays = (new Date(refresh.expires!).getTime() - Date.now()) / 86_400_000;
    expect(lifetimeDays).toBeGreaterThan(6.99);
    expect(lifetimeDays).toBeLessThan(7.01);
  });

  it('токены есть только в куках, а не в теле ответа', async () => {
    const { response, cookies } = await login();

    expect(response.body).not.toContain(cookies.et_access);
    expect(response.body).not.toContain(cookies.et_refresh);
    expect(response.body).not.toMatch(/password|hash|"id"/i);
  });

  it('куки получают Secure, когда сайт открыт по HTTPS за прокси', async () => {
    t = await createTestApp(database, { trustProxy: true });

    const { response } = await login('misha', TEST_PASSWORD, {
      headers: { 'x-forwarded-proto': 'https' },
    });

    expect(cookie(response, 'et_access').secure).toBe(true);
    expect(cookie(response, 'et_refresh').secure).toBe(true);
  });

  it('заголовок X-Forwarded-Proto игнорируется, если прокси не доверенный', async () => {
    const { response } = await login('misha', TEST_PASSWORD, {
      headers: { 'x-forwarded-proto': 'https' },
    });

    expect(cookie(response, 'et_access').secure).toBeFalsy();
  });

  it.each([
    ['неверный пароль', { username: 'misha', password: 'wrong-password-1' }],
    ['неизвестный логин', { username: 'nobody', password: TEST_PASSWORD }],
    ['пустое тело', {}],
    ['пароль не строка', { username: 'misha', password: 123 }],
  ])('%s: 401 без кук и без подробностей', async (_name, payload) => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...json, origin: TEST_ORIGIN },
      payload: body(payload),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Неверный логин или пароль',
    });
    expect(response.cookies).toHaveLength(0);
  });

  it('после пяти неудач — 429 с Retry-After, вход с верным паролем тоже блокируется', async () => {
    t = await createTestApp(database, { throttle: new LoginThrottle() });
    for (let i = 0; i < 5; i++)
      await login('misha', 'wrong-password-1', { remoteAddress: '10.0.0.1' });

    const { response } = await login('misha', TEST_PASSWORD, { remoteAddress: '10.0.0.1' });

    expect(response.statusCode).toBe(429);
    // The clock is real: a couple of milliseconds pass since the first attempt
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(899);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(response.json().error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(response.cookies).toHaveLength(0);
  });

  it('вход без заголовка Origin отклоняется (защита от CSRF)', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: body({ username: 'misha', password: TEST_PASSWORD }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN_ORIGIN');
  });
});

describe('защита маршрутов', () => {
  it.each([
    ['GET', '/api/cards'],
    ['GET', '/api/categories'],
    ['GET', '/api/config'],
    ['GET', '/api/sync/status'],
    ['GET', '/api/auth/me'],
    ['POST', '/api/sync'],
    ['POST', '/api/expenses'],
    ['GET', '/api/unknown'],
  ])('%s %s без входа: 401', async (method, url) => {
    const response = await t.app.inject({
      method: method as 'GET',
      url,
      headers: { origin: TEST_ORIGIN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toEqual({ code: 'UNAUTHENTICATED', message: 'Требуется вход' });
  });

  it('/api/health доступен без входа', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('с входом маршруты работают', async () => {
    const { cookies } = await login();

    const cards = await authed(cookies, { method: 'GET', url: '/api/cards' });
    const me = await authed(cookies, { method: 'GET', url: '/api/auth/me' });

    expect(cards.statusCode).toBe(200);
    expect(me.json().data.user).toEqual({
      username: 'misha',
      displayName: 'Миша',
      card: 'Миша',
      canEdit: true,
      timezone: 'Asia/Yerevan',
      defaultTimezone: 'Asia/Yerevan',
      role: 'owner',
      isAdmin: true,
    });
  });

  it('подделанная или чужая кука не даёт доступа', async () => {
    for (const value of ['forged', '', 'a'.repeat(300)]) {
      const response = await authed({ et_access: value }, { method: 'GET', url: '/api/cards' });
      expect(response.statusCode).toBe(401);
    }
  });

  it('refresh-токен вместо access-токена не даёт доступа', async () => {
    const { cookies } = await login();

    const response = await authed(
      { et_access: cookies.et_refresh! },
      { method: 'GET', url: '/api/cards' },
    );

    expect(response.statusCode).toBe(401);
  });
});

describe('автор расхода и ключи идемпотентности', () => {
  const expense = { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 640 };
  const post = (as: 'misha' | 'nastya', key: string) =>
    t.inject(
      {
        method: 'POST',
        url: '/api/expenses',
        headers: { ...json, 'idempotency-key': key },
        payload: body(expense),
      },
      as,
    );

  it('расход записывается от имени вошедшего пользователя', async () => {
    await post('nastya', 'key-for-nastya-1');

    const [row] = await database.query<{ created_by: string }>('SELECT created_by FROM expenses');
    expect(row!.created_by).toBe('nastya');
  });

  it('одинаковый ключ у разных пользователей — это разные запросы', async () => {
    const first = await post('misha', 'shared-key-0001');
    const second = await post('nastya', 'shared-key-0001');

    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(await database.query('SELECT 1 FROM expenses')).toHaveLength(2);
  });
});

describe('POST /api/auth/refresh', () => {
  it('выдаёт новые куки и делает прежний access недействительным', async () => {
    const { cookies } = await login();

    const response = await authed(
      { et_refresh: cookies.et_refresh! },
      { method: 'POST', url: '/api/auth/refresh' },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ refreshed: true, user: { username: 'misha' } });
    const fresh = cookiesOf(response);
    expect(fresh.et_access).toBeTruthy();
    expect(fresh.et_refresh).not.toBe(cookies.et_refresh);
    expect(
      (await authed({ et_access: cookies.et_access! }, { method: 'GET', url: '/api/cards' }))
        .statusCode,
    ).toBe(401);
    expect(
      (await authed({ et_access: fresh.et_access! }, { method: 'GET', url: '/api/cards' }))
        .statusCode,
    ).toBe(200);
  });

  it('работает без access-куки: это и есть сценарий «вошёл вчера»', async () => {
    const { cookies } = await login();

    const response = await authed(
      { et_refresh: cookies.et_refresh! },
      { method: 'POST', url: '/api/auth/refresh' },
    );

    expect(response.statusCode).toBe(200);
  });

  it('без refresh-куки — 401', async () => {
    const response = await authed({}, { method: 'POST', url: '/api/auth/refresh' });

    expect(response.statusCode).toBe(401);
  });

  it('неверный refresh-токен — 401 и куки сбрасываются', async () => {
    const response = await authed(
      { et_refresh: 'forged' },
      { method: 'POST', url: '/api/auth/refresh' },
    );

    expect(response.statusCode).toBe(401);
    const cleared = response.cookies.filter(
      (c) => c.name === 'et_access' || c.name === 'et_refresh',
    );
    expect(cleared).toHaveLength(2);
    expect(cleared.every((c) => c.value === '')).toBe(true);
  });

  it('два одновременных обновления одним токеном (две вкладки) не выбрасывают пользователя', async () => {
    const { cookies } = await login();
    const request = () =>
      authed({ et_refresh: cookies.et_refresh! }, { method: 'POST', url: '/api/auth/refresh' });

    const [a, b] = await Promise.all([request(), request()]);

    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a, b].filter((r) => r.json().data.refreshed)).toHaveLength(1);
    const winner = [a, b].find((r) => r.json().data.refreshed)!;
    expect(
      (
        await authed(
          { et_access: cookiesOf(winner).et_access! },
          { method: 'GET', url: '/api/cards' },
        )
      ).statusCode,
    ).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  it('завершает сессию и очищает куки', async () => {
    const { cookies } = await login();

    const response = await authed(cookies, { method: 'POST', url: '/api/auth/logout' });

    expect(response.statusCode).toBe(200);
    expect(
      response.cookies
        .filter((c) => c.value === '')
        .map((c) => c.name)
        .sort(),
    ).toEqual(['et_access', 'et_refresh']);
    expect(
      (await authed({ et_access: cookies.et_access! }, { method: 'GET', url: '/api/cards' }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await authed(
          { et_refresh: cookies.et_refresh! },
          { method: 'POST', url: '/api/auth/refresh' },
        )
      ).statusCode,
    ).toBe(401);
  });

  it('выход без сессии не падает', async () => {
    const response = await authed({}, { method: 'POST', url: '/api/auth/logout' });

    expect(response.statusCode).toBe(200);
  });

  it('выход на одном устройстве не трогает другое', async () => {
    const phone = (await login()).cookies;
    const laptop = (await login()).cookies;

    await authed(phone, { method: 'POST', url: '/api/auth/logout' });

    expect((await authed(laptop, { method: 'GET', url: '/api/cards' })).statusCode).toBe(200);
  });
});

describe('защита от CSRF (проверка Origin)', () => {
  const expense = { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 640 };
  const post = async (headers: Record<string, string>, app: TestApp = t) => {
    const cookies = await app.sessionCookies('misha');
    return app.app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies,
      headers: {
        ...json,
        'idempotency-key': `key-${Math.random().toString(36).slice(2, 12)}`,
        ...headers,
      },
      payload: body(expense),
    });
  };

  it('запрос с нашего сайта проходит', async () => {
    expect((await post({ origin: TEST_ORIGIN })).statusCode).toBe(201);
  });

  it('запрос с чужого сайта отклоняется, даже с действующими куками', async () => {
    const response = await post({ origin: 'https://evil.example.com' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN_ORIGIN');
    expect(await database.query('SELECT 1 FROM expenses')).toHaveLength(0);
  });

  it('запрос без Origin и Referer отклоняется', async () => {
    expect((await post({})).statusCode).toBe(403);
  });

  it('если нет Origin, проверяется Referer', async () => {
    expect((await post({ referer: `${TEST_ORIGIN}/page` })).statusCode).toBe(201);
    expect((await post({ referer: 'https://evil.example.com/page' })).statusCode).toBe(403);
  });

  it('Origin с портом по умолчанию считается тем же сайтом', async () => {
    expect((await post({ origin: 'http://localhost:80' })).statusCode).toBe(201);
  });

  it('Origin на другом порту — чужой источник', async () => {
    expect((await post({ origin: 'http://localhost:9999' })).statusCode).toBe(403);
  });

  it('за прокси сравнивается с адресом, под которым сайт открыт (X-Forwarded-Host)', async () => {
    t = await createTestApp(database, { trustProxy: true });

    const ok = await post({
      origin: 'https://expenses.example.com',
      'x-forwarded-host': 'expenses.example.com',
    });
    const wrong = await post({
      origin: 'https://evil.example.com',
      'x-forwarded-host': 'expenses.example.com',
    });

    expect([ok.statusCode, wrong.statusCode]).toEqual([201, 403]);
  });

  it('дополнительные источники можно разрешить настройкой', async () => {
    t = await createTestApp(database, { allowedOrigins: ['https://app.example.com'] });

    expect((await post({ origin: 'https://app.example.com' })).statusCode).toBe(201);
  });

  it('безопасные методы (GET) не требуют Origin', async () => {
    const cookies = await t.sessionCookies('misha');

    const response = await t.app.inject({ method: 'GET', url: '/api/cards', cookies });

    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/auth/password', () => {
  const NEW_PASSWORD = 'brand-new-password-9';

  const changePassword = (
    cookies: Record<string, string>,
    payload: unknown,
    headers: Record<string, string> = json,
  ) =>
    authed(cookies, {
      method: 'POST',
      url: '/api/auth/password',
      headers,
      payload: JSON.stringify(payload),
    });

  it('меняет пароль: новый работает, старый нет', async () => {
    const { cookies } = await login();

    const response = await changePassword(cookies, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect((await login('misha', NEW_PASSWORD)).response.statusCode).toBe(200);
    expect((await login('misha', TEST_PASSWORD)).response.statusCode).toBe(401);
  });

  it('текущая сессия остаётся, вход с другого устройства закрывается', async () => {
    const here = await login();
    const elsewhere = await login();

    await changePassword(here.cookies, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect((await authed(here.cookies, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(
      200,
    );
    expect(
      (await authed(elsewhere.cookies, { method: 'GET', url: '/api/auth/me' })).statusCode,
    ).toBe(401);
  });

  it('пароль и токены не попадают в ответ', async () => {
    const { cookies } = await login();

    const response = await changePassword(cookies, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.body).not.toContain(NEW_PASSWORD);
    expect(response.body).not.toContain(TEST_PASSWORD);
  });

  it.each([
    [
      'неверный текущий пароль',
      { currentPassword: 'wrong-password-1', newPassword: NEW_PASSWORD },
      'INVALID_CURRENT_PASSWORD',
    ],
    ['короткий новый', { currentPassword: TEST_PASSWORD, newPassword: 'short' }, 'WEAK_PASSWORD'],
    [
      'новый совпадает с текущим',
      { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
      'SAME_PASSWORD',
    ],
    ['нет полей', {}, 'INVALID_PASSWORD_REQUEST'],
    ['поля не строки', { currentPassword: 1, newPassword: 2 }, 'INVALID_PASSWORD_REQUEST'],
  ])('%s: 422 %s, пароль не меняется', async (_title, payload, code) => {
    const { cookies } = await login();

    const response = await changePassword(cookies, payload);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(code);
    expect((await login('misha', TEST_PASSWORD)).response.statusCode).toBe(200);
  });

  it('после пяти неверных попыток 429 с Retry-After', async () => {
    const { cookies } = await login();

    for (let i = 0; i < 5; i++) {
      await changePassword(cookies, {
        currentPassword: 'wrong-password-1',
        newPassword: NEW_PASSWORD,
      });
    }
    const blocked = await changePassword(cookies, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('без входа 401, без Origin сайта 403', async () => {
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/auth/password',
          headers: { ...json, origin: TEST_ORIGIN },
          payload: body({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }),
        })
      ).statusCode,
    ).toBe(401);

    const { cookies } = await login();
    const forged = await t.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies,
      headers: { ...json, origin: 'https://evil.example' },
      payload: body({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(forged.statusCode).toBe(403);
    expect((await login('misha', TEST_PASSWORD)).response.statusCode).toBe(200);
  });
});
