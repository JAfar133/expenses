import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../helpers/create-test-app.ts';
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
  await database.query("UPDATE users SET preferences = '{}'::jsonb");
});

const get = (as: 'misha' | 'nastya' = 'misha') =>
  t.inject({ method: 'GET', url: '/api/preferences' }, as);
const put = (payload: unknown, as: 'misha' | 'nastya' = 'misha') =>
  t.inject({ method: 'PUT', url: '/api/preferences', payload: payload as object }, as);

describe('настройки пользователя', () => {
  it('пока ничего не сохранено, настройки пусты', async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: {} });
  });

  it('сохраняются и читаются', async () => {
    const saved = await put({ 'daily.type': 'line', 'category.type': 'donut' });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toEqual({ 'daily.type': 'line', 'category.type': 'donut' });
    expect((await get()).json().data).toEqual({ 'daily.type': 'line', 'category.type': 'donut' });
  });

  it('новый запрос меняет только указанные ключи, остальные остаются', async () => {
    await put({ 'daily.type': 'line', 'matrix.type': 'lines' });

    const merged = await put({ 'daily.type': 'area' });

    expect(merged.json().data).toEqual({ 'daily.type': 'area', 'matrix.type': 'lines' });
  });

  it('у каждого пользователя свои настройки', async () => {
    await put({ 'daily.type': 'line' }, 'misha');
    await put({ 'daily.type': 'area' }, 'nastya');

    expect((await get('misha')).json().data['daily.type']).toBe('line');
    expect((await get('nastya')).json().data['daily.type']).toBe('area');
  });

  it('тема сохраняется, неизвестное значение отвергается', async () => {
    expect((await put({ theme: 'dark' })).json().data).toEqual({ theme: 'dark' });
    expect((await put({ theme: 'blue' })).statusCode).toBe(422);
  });

  it('пустой запрос ничего не меняет', async () => {
    await put({ 'daily.mode': 'cumulative' });

    expect((await put({})).json().data).toEqual({ 'daily.mode': 'cumulative' });
  });

  it.each([
    ['недопустимое значение', { 'daily.type': 'radar' }],
    ['неизвестный ключ', { password: 'x' }],
    ['значение не того типа', { 'daily.type': 5 }],
    ['месяцев не из списка', { 'compare.months': '7' }],
    ['валюта не из списка', { 'analytics.currency': 'GBP' }],
    ['валюта строчными буквами', { 'analytics.currency': 'usd' }],
    ['вложенный объект', { 'daily.type': { a: 1 } }],
  ])('%s: 422, настройки не меняются', async (_title, payload) => {
    await put({ 'daily.type': 'line' });

    const response = await put(payload);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_PREFERENCES');
    expect((await get()).json().data).toEqual({ 'daily.type': 'line' });
  });

  it('без входа 401', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/preferences' })).statusCode).toBe(401);
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: '/api/preferences',
          payload: { 'daily.type': 'line' },
          headers: { origin: TEST_ORIGIN },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('все допустимые значения принимаются', async () => {
    const all = {
      'daily.type': 'area',
      'daily.mode': 'cumulative',
      'category.type': 'pie',
      'matrix.type': 'lines',
      'compare.months': '24',
      'analytics.currency': 'USD',
    };

    expect((await put(all)).json().data).toEqual(all);
  });
});
