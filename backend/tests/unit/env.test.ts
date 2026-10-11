import { describe, expect, it } from 'vitest';
import { loadEnv, readUserPasswords } from '../../src/config/env.ts';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost/db',
  ONEDRIVE_FILE_PATH: 'Документы/test.xlsx',
};

describe('пользователи (AUTH_USERS)', () => {
  it('по умолчанию заведены misha и nastya со своими картами', () => {
    expect(loadEnv(base).AUTH_USERS).toEqual([
      { username: 'misha', card: 'Миша' },
      { username: 'nastya', card: 'Настя' },
    ]);
  });

  it('разбирает логины и карты, лишние пробелы убираются', () => {
    const env = loadEnv({ ...base, AUTH_USERS: ' ivan : Иван , olga:Ольга ' });

    expect(env.AUTH_USERS).toEqual([
      { username: 'ivan', card: 'Иван' },
      { username: 'olga', card: 'Ольга' },
    ]);
  });

  it.each([
    ['без карты', 'misha'],
    ['пустая карта', 'misha:'],
    ['логин с заглавными буквами', 'Misha:Миша'],
    ['логин с дефисом (не годится для имени переменной)', 'mi-sha:Миша'],
    ['логин начинается с цифры', '1misha:Миша'],
    ['слишком короткий логин', 'm:Миша'],
  ])('отклоняет некорректную запись: %s', (_name, value) => {
    expect(() => loadEnv({ ...base, AUTH_USERS: value })).toThrow(/AUTH_USERS/);
  });
});

describe('пароли пользователей', () => {
  const users = [
    { username: 'misha', card: 'Миша' },
    { username: 'nastya', card: 'Настя' },
  ];

  it('читаются из AUTH_PASSWORD_<ЛОГИН>', () => {
    const passwords = readUserPasswords(users, {
      AUTH_PASSWORD_MISHA: 'misha-long-password-1',
      AUTH_PASSWORD_NASTYA: 'nastya-long-password-1',
    });

    expect(passwords).toEqual(
      new Map([
        ['misha', 'misha-long-password-1'],
        ['nastya', 'nastya-long-password-1'],
      ]),
    );
  });

  it('пустое и отсутствующее значения означают «пароль не задан»', () => {
    const passwords = readUserPasswords(users, { AUTH_PASSWORD_MISHA: '' });

    expect(passwords.size).toBe(0);
  });

  it('пароль не обрезается и не меняется', () => {
    const passwords = readUserPasswords(users, {
      AUTH_PASSWORD_MISHA: ' пароль с пробелами и !$# ',
    });

    expect(passwords.get('misha')).toBe(' пароль с пробелами и !$# ');
  });
});

describe('сроки и прокси', () => {
  it('значения по умолчанию: access 24 часа, refresh 7 дней, предел сессии 30 дней', () => {
    const env = loadEnv(base);

    expect(env).toMatchObject({
      ACCESS_TOKEN_TTL_HOURS: 24,
      REFRESH_TOKEN_TTL_DAYS: 7,
      SESSION_MAX_DAYS: 30,
      AUTH_MIN_PASSWORD_LENGTH: 8,
      TRUST_PROXY: false,
      ALLOWED_ORIGINS: [],
    });
  });

  it('читает значения из окружения', () => {
    const env = loadEnv({
      ...base,
      ACCESS_TOKEN_TTL_HOURS: '12',
      REFRESH_TOKEN_TTL_DAYS: '14',
      TRUST_PROXY: 'true',
      ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
    });

    expect(env).toMatchObject({
      ACCESS_TOKEN_TTL_HOURS: 12,
      REFRESH_TOKEN_TTL_DAYS: 14,
      TRUST_PROXY: true,
      ALLOWED_ORIGINS: ['https://a.example.com', 'https://b.example.com'],
    });
  });

  it('слишком короткий минимальный пароль не допускается', () => {
    expect(() => loadEnv({ ...base, AUTH_MIN_PASSWORD_LENGTH: '4' })).toThrow();
  });
});
