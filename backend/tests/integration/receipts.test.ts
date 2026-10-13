import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Receipt photos: off by default, per category, rights follow the expense. */
let database: Database;
let t: TestApp;
let receiptsDir: string;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const NOW = new Date('2026-10-15T09:00:00Z');

const rows = <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params);

const addExpense = async (as: string, category = 'кафе', card = 'Миша') => {
  const response = await t.inject(
    {
      method: 'POST',
      url: '/api/expenses',
      headers: { 'idempotency-key': `key-${Math.random().toString(36).slice(2)}-xx` },
      payload: { date: '2026-10-15', card, category, name: 'Чек', amount: 100 },
    },
    as,
  );
  return response.json().data.id as string;
};

const upload = (id: string, body: Buffer, as = 'misha', type = 'image/jpeg') =>
  t.inject(
    {
      method: 'PUT',
      url: `/api/expenses/${id}/receipt`,
      headers: { 'content-type': type },
      payload: body,
    },
    as,
  );

const enable = (categories = ['кафе']) =>
  t.inject({ method: 'PUT', url: '/api/group/receipts', payload: { enabled: true, categories } });

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expense_attachments; DELETE FROM expenses; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  receiptsDir = mkdtempSync(path.join(tmpdir(), 'receipts-test-'));
  t = await createTestApp(database, { now: () => NOW, receiptsDir });
});

describe('настройки', () => {
  it('по умолчанию выключено: прикрепить нельзя', async () => {
    const id = await addExpense('misha');

    const response = await upload(id, JPEG);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('RECEIPTS_OFF');
  });

  it('владелец включает и выбирает категории, участник их видит', async () => {
    expect((await enable(['кафе'])).statusCode).toBe(200);

    const settings = (
      await t.inject({ method: 'GET', url: '/api/receipts/settings' }, 'nastya')
    ).json();
    expect(settings.data).toEqual({
      enabled: true,
      categories: ['кафе'],
      aiCategories: expect.arrayContaining(['кафе']),
    });
  });

  it('участник не меняет настройки', async () => {
    const response = await t.inject(
      { method: 'PUT', url: '/api/group/receipts', payload: { enabled: true, categories: [] } },
      'nastya',
    );

    expect(response.statusCode).toBe(403);
  });
});

describe('фото траты', () => {
  beforeEach(async () => {
    await enable(['кафе']);
  });

  it('сохраняется, отдаётся и отмечается в списке', async () => {
    const id = await addExpense('misha');

    expect((await upload(id, JPEG)).statusCode).toBe(200);

    const photo = await t.inject({ method: 'GET', url: `/api/expenses/${id}/receipt` });
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.rawPayload.equals(JPEG)).toBe(true);
    const list = (await t.inject({ method: 'GET', url: '/api/expenses' })).json().data.items;
    expect(list[0].hasReceipt).toBe(true);
  });

  it('в категорию без разрешения нельзя', async () => {
    const id = await addExpense('misha', 'продукты');

    expect((await upload(id, JPEG)).statusCode).toBe(403);
  });

  it('не изображение отклоняется, даже с заголовком image/jpeg', async () => {
    const id = await addExpense('misha');

    const response = await upload(id, Buffer.from('not a picture at all'));

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_RECEIPT');
  });

  it('замена и удаление оставляют файлы на диске, снимается только отметка', async () => {
    const id = await addExpense('misha');
    await upload(id, JPEG);
    await upload(id, Buffer.concat([JPEG, Buffer.from([2])]));

    const all = await rows<{ file_path: string; deleted_at: string | null }>(
      'SELECT file_path, deleted_at FROM expense_attachments ORDER BY created_at',
    );
    expect(all).toHaveLength(2);
    expect(all[0]!.deleted_at).not.toBeNull();
    expect(all[1]!.deleted_at).toBeNull();

    await t.inject({ method: 'DELETE', url: `/api/expenses/${id}/receipt` });

    expect((await t.inject({ method: 'GET', url: `/api/expenses/${id}/receipt` })).statusCode).toBe(
      404,
    );
    for (const { file_path } of all)
      expect(existsSync(path.join(receiptsDir, file_path))).toBe(true);
  });

  it('участник добавляет фото к своей трате, к чужой нельзя', async () => {
    const own = await addExpense('nastya');
    const foreign = await addExpense('misha');

    expect((await upload(own, JPEG, 'nastya')).statusCode).toBe(200);
    expect((await upload(foreign, JPEG, 'nastya')).statusCode).toBe(403);
  });

  it('участник не видит фото траты по скрытой карте', async () => {
    const id = await addExpense('misha', 'кафе', 'Настя');
    await upload(id, JPEG);
    await database.query(
      "DELETE FROM card_access WHERE user_id = (SELECT id FROM users WHERE username = 'nastya') AND card_id = (SELECT id FROM cards WHERE name = 'Настя')",
    );

    expect(
      (await t.inject({ method: 'GET', url: `/api/expenses/${id}/receipt` }, 'nastya')).statusCode,
    ).toBe(404);
  });

  it('фото чужой группы выглядит как отсутствующее', async () => {
    const id = await addExpense('misha');
    await upload(id, JPEG);
    await t.authRepository.upsertUser('lone', 'lone', { timezone: 'UTC' });

    expect(
      (await t.inject({ method: 'GET', url: `/api/expenses/${id}/receipt` }, 'lone')).statusCode,
    ).toBe(404);
  });

  it('слишком большое фото отклоняется', async () => {
    const id = await addExpense('misha');

    const response = await upload(id, Buffer.concat([JPEG, Buffer.alloc(16 * 1024 * 1024)]));

    expect(response.statusCode).toBe(413);
  });
});
