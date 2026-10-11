import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { AuthRepository } from '../../src/modules/auth/auth.repository.ts';
import { AuthService, type AuthConfig } from '../../src/modules/auth/auth.service.ts';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const USERS = [
  { username: 'misha', card: 'Миша' },
  { username: 'nastya', card: 'Настя' },
];
const PASSWORDS = new Map([
  ['misha', 'misha-long-password-1'],
  ['nastya', 'nastya-long-password-1'],
]);

const config: AuthConfig = {
  accessTtlMs: 24 * HOUR,
  refreshTtlMs: 7 * DAY,
  sessionMaxMs: 30 * DAY,
  rotationGraceMs: 15_000,
  minPasswordLength: 12,
};

let database: Database;
let repository: AuthRepository;
let now: number;
let auth: AuthService;

const createService = (
  overrides: Partial<AuthConfig> = {},
  throttle = new LoginThrottle({ now: () => now }),
) =>
  new AuthService({
    repository,
    config: { ...config, ...overrides },
    throttle,
    now: () => new Date(now),
  });

beforeAll(async () => {
  database = await createTestDatabase();
  repository = new AuthRepository(database);
});

afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM auth_sessions');
  await database.query('DELETE FROM users');
  now = Date.parse('2026-10-11T12:00:00Z');
  auth = createService();
  await auth.syncUsers(USERS, PASSWORDS);
});

const login = (username = 'misha', password = PASSWORDS.get(username)!) =>
  auth.login(username, password, { ip: '1.1.1.1' });

describe('синхронизация пользователей с настройками', () => {
  it('создаёт пользователей с картой по умолчанию и без хранения открытого пароля', async () => {
    const misha = await repository.findUser('misha');

    expect(misha).toMatchObject({
      username: 'misha',
      card: 'Миша',
      displayName: 'Миша',
      disabled: false,
    });
    expect(misha?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(await database.query('SELECT * FROM users'))).not.toContain(
      'misha-long-password-1',
    );
  });

  it('повторный запуск с теми же паролями ничего не меняет и не завершает сессии', async () => {
    const { tokens } = await login();

    const again = await auth.syncUsers(USERS, PASSWORDS);

    expect(again.passwordsUpdated).toEqual([]);
    expect(await auth.authenticate(tokens.accessToken)).toBeDefined();
  });

  it('изменённый пароль обновляется, а все сессии пользователя завершаются', async () => {
    const { tokens } = await login();
    const other = await login('nastya');

    const result = await auth.syncUsers(
      USERS,
      new Map([...PASSWORDS, ['misha', 'misha-new-password-2']]),
    );

    expect(result.passwordsUpdated).toEqual(['misha']);
    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
    expect(await auth.authenticate(other.tokens.accessToken)).toBeDefined();
    await expect(login('misha', 'misha-long-password-1')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(login('misha', 'misha-new-password-2')).resolves.toBeDefined();
  });

  it('карта по умолчанию обновляется из настроек', async () => {
    await auth.syncUsers([{ username: 'misha', card: 'Настя' }, USERS[1]!], PASSWORDS);

    expect((await login()).user.card).toBe('Настя');
  });

  it('пользователь без пароля не может войти и попадает в отчёт', async () => {
    await database.query('DELETE FROM users');
    const result = await auth.syncUsers(USERS, new Map([['misha', 'misha-long-password-1']]));

    expect(result.withoutPassword).toEqual(['nastya']);
    await expect(auth.login('nastya', 'whatever-password-12')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('пользователи, которых убрали из настроек, отключаются вместе с сессиями', async () => {
    const { tokens } = await login('nastya');

    await auth.syncUsers([USERS[0]!], PASSWORDS);

    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
    await expect(login('nastya')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('вернувшийся в настройки пользователь снова может войти', async () => {
    await auth.syncUsers([USERS[0]!], PASSWORDS);

    await auth.syncUsers(USERS, PASSWORDS);

    await expect(login('nastya')).resolves.toBeDefined();
  });

  it('слишком короткий пароль отклоняется с понятной ошибкой', async () => {
    await expect(auth.syncUsers(USERS, new Map([['misha', 'short']]))).rejects.toThrow(
      /слишком короткий/,
    );
  });
});

describe('вход', () => {
  it('успешный вход возвращает пользователя с картой и пару токенов на 24 часа и 7 дней', async () => {
    const { user, tokens } = await login('nastya');

    expect(user).toMatchObject({ username: 'nastya', card: 'Настя' });
    expect(tokens.accessExpiresAt.getTime()).toBe(now + 24 * HOUR);
    expect(tokens.refreshExpiresAt.getTime()).toBe(now + 7 * DAY);
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);
  });

  it('в базе хранятся только хеши токенов', async () => {
    const { tokens } = await login();

    const dump = JSON.stringify(await database.query('SELECT * FROM auth_sessions'));

    expect(dump).not.toContain(tokens.accessToken);
    expect(dump).not.toContain(tokens.refreshToken);
  });

  it('логин не чувствителен к регистру и пробелам', async () => {
    await expect(auth.login('  MiShA ', PASSWORDS.get('misha')!, {})).resolves.toBeDefined();
  });

  it.each([
    ['неверный пароль', 'misha', 'wrong-password-123'],
    ['неизвестный пользователь', 'nobody', 'misha-long-password-1'],
    ['пустой пароль', 'misha', ''],
    ['слишком длинный пароль', 'misha', 'x'.repeat(5000)],
  ])('%s: одинаковая ошибка, которая не раскрывает причину', async (_name, username, password) => {
    await expect(auth.login(username, password, { ip: '1.1.1.1' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Неверный логин или пароль',
    });
  });

  it('после пяти неудач вход блокируется (429) даже с верным паролем', async () => {
    for (let i = 0; i < 5; i++) {
      await auth.login('misha', 'wrong-password-123', { ip: '1.1.1.1' }).catch(() => undefined);
    }

    await expect(login()).rejects.toMatchObject({ statusCode: 429, code: 'TOO_MANY_ATTEMPTS' });
    const error = await login().catch((e) => e);
    expect(error.headers['Retry-After']).toBe(String(15 * 60));
  });

  it('параллельные попытки не обходят лимит: проверяются только разрешённые', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        auth.login('misha', 'wrong-password-123', { ip: '1.1.1.1' }),
      ),
    );

    const blocked = attempts.filter(
      (a) => a.status === 'rejected' && (a.reason as { statusCode: number }).statusCode === 429,
    );
    expect(blocked).toHaveLength(20);
  });

  it('блокировка проходит со временем', async () => {
    for (let i = 0; i < 5; i++) {
      await auth.login('misha', 'wrong-password-123', { ip: '1.1.1.1' }).catch(() => undefined);
    }

    now += 16 * 60_000;

    await expect(login()).resolves.toBeDefined();
  });

  it('другой адрес не страдает от блокировки', async () => {
    for (let i = 0; i < 5; i++) {
      await auth.login('misha', 'wrong-password-123', { ip: '1.1.1.1' }).catch(() => undefined);
    }

    await expect(
      auth.login('misha', PASSWORDS.get('misha')!, { ip: '2.2.2.2' }),
    ).resolves.toBeDefined();
  });
});

describe('проверка access-токена', () => {
  it('возвращает пользователя по токену', async () => {
    const { tokens } = await login();

    expect(await auth.authenticate(tokens.accessToken)).toMatchObject({
      username: 'misha',
      card: 'Миша',
    });
  });

  it('чужой и пустой токены не подходят', async () => {
    expect(await auth.authenticate('not-a-token')).toBeUndefined();
    expect(await auth.authenticate('')).toBeUndefined();
  });

  it('истекает через 24 часа', async () => {
    const { tokens } = await login();

    now += 24 * HOUR - 1000;
    expect(await auth.authenticate(tokens.accessToken)).toBeDefined();
    now += 2000;
    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
  });

  it('refresh-токен не годится как access-токен', async () => {
    const { tokens } = await login();

    expect(await auth.authenticate(tokens.refreshToken)).toBeUndefined();
  });
});

describe('обновление по refresh-токену', () => {
  it('после истечения access новый выдаётся без пароля', async () => {
    const { tokens } = await login();
    now += 25 * HOUR;
    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();

    const refreshed = await auth.refresh(tokens.refreshToken);

    expect(refreshed.tokens).toBeDefined();
    expect(await auth.authenticate(refreshed.tokens!.accessToken)).toMatchObject({
      username: 'misha',
    });
  });

  it('refresh-токен меняется: старый access перестаёт работать, новый refresh продлевает неделю', async () => {
    const { tokens } = await login();
    now += 3 * DAY;

    const { tokens: next } = await auth.refresh(tokens.refreshToken);

    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
    expect(next!.refreshToken).not.toBe(tokens.refreshToken);
    expect(next!.refreshExpiresAt.getTime()).toBe(now + 7 * DAY);
    expect(next!.accessExpiresAt.getTime()).toBe(now + 24 * HOUR);
  });

  it('можно обновляться много раз подряд', async () => {
    let { tokens } = await login();
    for (let i = 0; i < 5; i++) {
      now += 2 * DAY;
      tokens = (await auth.refresh(tokens.refreshToken)).tokens!;
    }

    expect(await auth.authenticate(tokens.accessToken)).toBeDefined();
  });

  it('истекает через 7 дней без использования', async () => {
    const { tokens } = await login();

    now += 7 * DAY + 1000;

    await expect(auth.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('сессия живёт не дольше предела (30 дней), сколько бы её ни обновляли', async () => {
    let { tokens } = await login();
    for (let day = 5; day <= 25; day += 5) {
      now = Date.parse('2026-10-11T12:00:00Z') + day * DAY;
      tokens = (await auth.refresh(tokens.refreshToken)).tokens!;
    }
    now = Date.parse('2026-10-11T12:00:00Z') + 29 * DAY;
    const last = (await auth.refresh(tokens.refreshToken)).tokens!;

    // The refresh token lifetime is capped by the session limit
    expect(last.refreshExpiresAt.getTime()).toBe(Date.parse('2026-10-11T12:00:00Z') + 30 * DAY);
    now = Date.parse('2026-10-11T12:00:00Z') + 30 * DAY + 1000;
    await expect(auth.refresh(last.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('access-токен тоже не живёт дольше предела сессии', async () => {
    let { tokens } = await login();
    for (let day = 5; day <= 25; day += 5) {
      now = Date.parse('2026-10-11T12:00:00Z') + day * DAY;
      tokens = (await auth.refresh(tokens.refreshToken)).tokens!;
    }
    now = Date.parse('2026-10-11T12:00:00Z') + 29.5 * DAY;
    tokens = (await auth.refresh(tokens.refreshToken)).tokens!;

    expect(tokens.accessExpiresAt.getTime()).toBe(Date.parse('2026-10-11T12:00:00Z') + 30 * DAY);
    now = Date.parse('2026-10-11T12:00:00Z') + 30 * DAY + 1000;
    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
  });

  it('повторное предъявление старого токена сразу после обновления (гонка вкладок) не ломает сессию', async () => {
    const { tokens } = await login();
    const first = await auth.refresh(tokens.refreshToken);

    now += 3000;
    const second = await auth.refresh(tokens.refreshToken);

    expect(second.tokens).toBeUndefined(); // the cookies were already refreshed by the first request
    expect(await auth.authenticate(first.tokens!.accessToken)).toBeDefined();
  });

  it('старый токен, предъявленный позже окна гонки, считается кражей: сессия закрывается', async () => {
    const { tokens } = await login();
    const first = await auth.refresh(tokens.refreshToken);

    now += 60_000;

    await expect(auth.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    // The whole session is closed, including tokens issued on the first refresh
    expect(await auth.authenticate(first.tokens!.accessToken)).toBeUndefined();
    await expect(auth.refresh(first.tokens!.refreshToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('неизвестный токен отклоняется', async () => {
    await expect(auth.refresh('unknown')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('смена пароля завершает сессии, и refresh перестаёт работать', async () => {
    const { tokens } = await login();

    await auth.syncUsers(USERS, new Map([...PASSWORDS, ['misha', 'another-long-password-3']]));

    await expect(auth.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('выход', () => {
  it('завершает сессию: access и refresh больше не работают', async () => {
    const { tokens } = await login();

    await auth.logout(tokens.accessToken, tokens.refreshToken);

    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
    await expect(auth.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('работает и по одному refresh-токену (access уже истёк)', async () => {
    const { tokens } = await login();
    now += 25 * HOUR;

    await auth.logout(undefined, tokens.refreshToken);

    await expect(auth.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('другие сессии пользователя (другие устройства) остаются', async () => {
    const phone = await login();
    const laptop = await login();

    await auth.logout(phone.tokens.accessToken);

    expect(await auth.authenticate(laptop.tokens.accessToken)).toBeDefined();
  });

  it('выход без токенов безопасен', async () => {
    await expect(auth.logout()).resolves.toBeUndefined();
  });
});

describe('очистка', () => {
  it('удаляет давно истёкшие сессии и оставляет действующие', async () => {
    const old = await login();
    now += 10 * DAY;
    const fresh = await login();

    const removed = await auth.deleteStaleSessions();

    expect(removed).toBe(1);
    expect(await auth.authenticate(fresh.tokens.accessToken)).toBeDefined();
    expect(await auth.authenticate(old.tokens.accessToken)).toBeUndefined();
  });
});

describe('пароль из .env и пароль, заданный пользователем', () => {
  /** The user logs in and changes the password on their own. */
  async function changeOwnPassword(newPassword = 'new-misha-password-2') {
    const { user, tokens } = await login();
    await auth.changePassword(user, tokens.accessToken, PASSWORDS.get('misha')!, newPassword, {
      ip: '1.1.1.1',
    });
    return { user, tokens };
  }

  it('при первом запуске запоминается, что пароль из .env учтён', async () => {
    const misha = await repository.findUser('misha');

    expect(misha?.envPasswordHash).toBe(misha?.passwordHash);
  });

  it('после смены пароля перезапуск с прежним .env не возвращает старый пароль', async () => {
    await changeOwnPassword();

    const restart = await createService().syncUsers(USERS, PASSWORDS);

    expect(restart.passwordsUpdated).toEqual([]);
    await expect(login('misha', 'new-misha-password-2')).resolves.toBeDefined();
    await expect(login('misha')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('если значение в .env изменили, оно побеждает (администратор сбросил пароль) и сессии закрываются', async () => {
    const { tokens } = await changeOwnPassword();

    const reset = await createService().syncUsers(
      USERS,
      new Map([
        ['misha', 'admin-reset-password-3'],
        ['nastya', PASSWORDS.get('nastya')!],
      ]),
    );

    expect(reset.passwordsUpdated).toEqual(['misha']);
    await expect(login('misha', 'admin-reset-password-3')).resolves.toBeDefined();
    await expect(login('misha', 'new-misha-password-2')).rejects.toBeDefined();
    expect(await auth.authenticate(tokens.accessToken)).toBeUndefined();
  });

  it('после смены пароля в .env возврат к прежнему значению тоже считается сбросом', async () => {
    await changeOwnPassword();
    await createService().syncUsers(
      USERS,
      new Map([
        ['misha', 'admin-reset-password-3'],
        ['nastya', PASSWORDS.get('nastya')!],
      ]),
    );

    const back = await createService().syncUsers(USERS, PASSWORDS);

    expect(back.passwordsUpdated).toEqual(['misha']);
  });

  it('база без сведений об .env (после миграции): совпадающий пароль не затрагивает сессии', async () => {
    const { tokens } = await login();
    await database.query('UPDATE users SET env_password_hash = NULL');

    const result = await createService().syncUsers(USERS, PASSWORDS);

    expect(result.passwordsUpdated).toEqual([]);
    expect(await auth.authenticate(tokens.accessToken)).toBeDefined();
    expect((await repository.findUser('misha'))?.envPasswordHash).not.toBeNull();
  });

  it('база без сведений об .env, а пароль в .env другой: применяется .env', async () => {
    await database.query('UPDATE users SET env_password_hash = NULL');

    const result = await createService().syncUsers(
      USERS,
      new Map([
        ['misha', 'another-env-password-4'],
        ['nastya', PASSWORDS.get('nastya')!],
      ]),
    );

    expect(result.passwordsUpdated).toEqual(['misha']);
  });
});

describe('смена пароля пользователем', () => {
  const change = (current: string, next: string, accessToken?: string) =>
    login().then(({ user, tokens }) =>
      auth.changePassword(user, accessToken ?? tokens.accessToken, current, next, {
        ip: '1.1.1.1',
      }),
    );

  it('новый пароль работает, старый нет', async () => {
    await change(PASSWORDS.get('misha')!, 'new-misha-password-2');

    await expect(login('misha', 'new-misha-password-2')).resolves.toBeDefined();
    await expect(login('misha')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('текущая сессия остаётся, остальные сессии пользователя закрываются', async () => {
    const current = await login();
    const other = await login();
    const nastya = await login('nastya');

    await auth.changePassword(
      current.user,
      current.tokens.accessToken,
      PASSWORDS.get('misha')!,
      'new-misha-password-2',
    );

    expect(await auth.authenticate(current.tokens.accessToken)).toBeDefined();
    expect(await auth.authenticate(other.tokens.accessToken)).toBeUndefined();
    expect(await auth.authenticate(nastya.tokens.accessToken)).toBeDefined();
  });

  it('неверный текущий пароль: ошибка, пароль не меняется', async () => {
    await expect(change('wrong-current-password', 'new-misha-password-2')).rejects.toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
    });

    await expect(login()).resolves.toBeDefined();
  });

  it('пять неверных попыток блокируют смену пароля, как и вход', async () => {
    const { user, tokens } = await login();

    for (let i = 0; i < 5; i++) {
      await expect(
        auth.changePassword(
          user,
          tokens.accessToken,
          'wrong-current-password',
          'new-misha-password-2',
          { ip: '1.1.1.1' },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
    }

    await expect(
      auth.changePassword(
        user,
        tokens.accessToken,
        PASSWORDS.get('misha')!,
        'new-misha-password-2',
        { ip: '1.1.1.1' },
      ),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });

  it('слишком короткий, слишком длинный и совпадающий с текущим пароли отклоняются', async () => {
    await expect(change(PASSWORDS.get('misha')!, 'short')).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
    await expect(change(PASSWORDS.get('misha')!, 'я'.repeat(1025))).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
    await expect(change(PASSWORDS.get('misha')!, PASSWORDS.get('misha')!)).rejects.toMatchObject({
      code: 'SAME_PASSWORD',
    });
    await expect(login()).resolves.toBeDefined();
  });

  it('минимальная длина берётся из настроек', async () => {
    auth = createService({ minPasswordLength: 8 });
    const { user, tokens } = await login();

    await expect(
      auth.changePassword(user, tokens.accessToken, PASSWORDS.get('misha')!, '12345678'),
    ).resolves.toBeUndefined();
  });

  it('пароль не хранится открытым текстом', async () => {
    await change(PASSWORDS.get('misha')!, 'new-misha-password-2');

    expect(JSON.stringify(await database.query('SELECT * FROM users'))).not.toContain(
      'new-misha-password-2',
    );
  });
});
