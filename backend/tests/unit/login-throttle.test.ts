import { beforeEach, describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.ts';

const MINUTE = 60_000;
let time: number;
let throttle: LoginThrottle;

beforeEach(() => {
  time = 1_000_000;
  throttle = new LoginThrottle({
    maxPerUser: 5,
    maxPerIp: 20,
    windowMs: 15 * MINUTE,
    now: () => time,
  });
});

const fail = (times: number, username = 'misha', ip = '1.1.1.1') => {
  for (let i = 0; i < times; i++) throttle.recordFailure(username, ip);
};

describe('попытки входа', () => {
  it('до лимита всё разрешено', () => {
    fail(4);

    expect(throttle.retryAfterSeconds('misha', '1.1.1.1')).toBe(0);
  });

  it('после пяти неудач блокируется на оставшееся время окна', () => {
    fail(5);

    expect(throttle.retryAfterSeconds('misha', '1.1.1.1')).toBe(15 * 60);
    time += 5 * MINUTE;
    expect(throttle.retryAfterSeconds('misha', '1.1.1.1')).toBe(10 * 60);
  });

  it('блокировка снимается, когда попытки выходят из окна', () => {
    fail(5);

    time += 15 * MINUTE + 1;

    expect(throttle.retryAfterSeconds('misha', '1.1.1.1')).toBe(0);
  });

  it('блокировка одной пары логин+адрес не мешает другому адресу и другому логину', () => {
    fail(5);

    expect(throttle.retryAfterSeconds('misha', '2.2.2.2')).toBe(0);
    expect(throttle.retryAfterSeconds('nastya', '1.1.1.1')).toBe(0);
  });

  it('успешный вход снимает счётчик пары', () => {
    fail(4);

    throttle.recordSuccess('misha', '1.1.1.1');
    fail(4);

    expect(throttle.retryAfterSeconds('misha', '1.1.1.1')).toBe(0);
  });

  it('перебор разных логинов с одного адреса блокируется общим лимитом на адрес', () => {
    for (let i = 0; i < 20; i++) throttle.recordFailure(`user${i}`, '9.9.9.9');

    expect(throttle.retryAfterSeconds('someone-new', '9.9.9.9')).toBeGreaterThan(0);
    expect(throttle.retryAfterSeconds('someone-new', '8.8.8.8')).toBe(0);
  });

  it('неудачи вне окна не учитываются', () => {
    fail(4);
    time += 16 * MINUTE;
    fail(4);

    expect(throttle.retryAfterSeconds('misha', '1.1.1.1')).toBe(0);
  });
});

describe('резервирование попытки', () => {
  it('считает попытку сразу, до проверки пароля', () => {
    for (let i = 0; i < 5; i++) expect(throttle.reserve('misha', '1.1.1.1')).toBe(0);

    expect(throttle.reserve('misha', '1.1.1.1')).toBeGreaterThan(0);
  });

  it('успешный вход возвращает попытку и сбрасывает счётчик пары', () => {
    for (let i = 0; i < 4; i++) throttle.reserve('misha', '1.1.1.1');
    throttle.recordSuccess('misha', '1.1.1.1');

    for (let i = 0; i < 5; i++) expect(throttle.reserve('misha', '1.1.1.1')).toBe(0);
  });

  it('устаревшие ключи удаляются сами, без повторного обращения к ним', () => {
    for (let i = 0; i < 50; i++) throttle.reserve(`user${i}`, `10.0.0.${i}`);
    expect(throttle.trackedKeys).toBeGreaterThan(50);

    time += 16 * MINUTE;
    throttle.reserve('someone', '7.7.7.7');

    expect(throttle.trackedKeys).toBe(2);
  });
});
