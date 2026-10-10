import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { IdempotencyService } from '../../src/infrastructure/idempotency/idempotency.service.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const KEY = 'key-0000-aaaa';
const payload = { amount: 100 };

let database: Database;
let service: IdempotencyService;

beforeEach(async () => {
  database = await createTestDatabase();
  service = new IdempotencyService(database);
});

afterEach(() => database.close());

const request = (overrides: { key?: string; userId?: string; payload?: unknown } = {}) => ({
  userId: 'misha',
  key: KEY,
  payload,
  ...overrides,
});

/** Запись, которую выполняет «работа»: так видно, сколько раз она реально произошла. */
const insertMarker = (
  tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  id: string,
) =>
  tx.query(
    'INSERT INTO sync_state (id, last_result) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify({ id })],
  );

describe('успешная операция', () => {
  it('повтор возвращает прежний результат без повторной работы', async () => {
    let runs = 0;
    const work = async () => ({ id: `expense-${++runs}` });

    const first = await service.run(request(), work);
    const second = await service.run(request(), work);

    expect(first).toEqual({ value: { id: 'expense-1' }, replayed: false });
    expect(second).toEqual({ value: { id: 'expense-1' }, replayed: true });
    expect(runs).toBe(1);
  });

  it('тот же ключ с другими данными отклоняется', async () => {
    await service.run(request(), async () => 'ok');

    await expect(
      service.run(request({ payload: { amount: 999 } }), async () => 'ok'),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('ключи разных пользователей не пересекаются', async () => {
    await service.run(request({ userId: 'misha' }), async () => 'misha');

    const other = await service.run(request({ userId: 'nastya' }), async () => 'nastya');

    expect(other).toEqual({ value: 'nastya', replayed: false });
  });
});

describe('атомарность', () => {
  it('ошибка в работе откатывает и работу, и ключ: повтор выполняется заново', async () => {
    await expect(
      service.run(request(), async (tx) => {
        await insertMarker(tx, 'first');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await database.query('SELECT 1 FROM sync_state')).toHaveLength(0);
    expect(await database.query('SELECT 1 FROM idempotency_keys')).toHaveLength(0);

    const retry = await service.run(request(), async () => 'saved');
    expect(retry).toEqual({ value: 'saved', replayed: false });
  });

  it('после ошибки тот же ключ можно использовать с исправленными данными', async () => {
    await expect(
      service.run(request(), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();

    const retry = await service.run(request({ payload: { amount: 200 } }), async () => 'saved');

    expect(retry.replayed).toBe(false);
  });

  it('одновременные запросы с одним ключом выполняют работу один раз', async () => {
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { id: 'one' };
    };

    const results = await Promise.all([service.run(request(), work), service.run(request(), work)]);

    expect(runs).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.value).toEqual(results[1]!.value);
  });
});

describe('очистка', () => {
  it('удаляет только старые ключи', async () => {
    await service.run(request(), async () => 'ok');

    expect(await service.deleteOlderThan(new Date(Date.now() - 60_000))).toBe(0);
    expect(await service.deleteOlderThan(new Date(Date.now() + 60_000))).toBe(1);
  });
});
