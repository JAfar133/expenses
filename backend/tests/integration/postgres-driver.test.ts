import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPostgresDatabase,
  waitForDatabase,
  type Database,
} from '../../src/infrastructure/database/database.ts';
import { migrate } from '../../src/infrastructure/database/migrate.ts';
import { IdempotencyService } from '../../src/infrastructure/idempotency/idempotency.service.ts';
import { SyncStateRepository } from '../../src/modules/sync/sync-state.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { okResult } from '../helpers/create-test-app.ts';

/**
 * Настоящий драйвер `pg` (тот, что работает в production) по сетевому протоколу PostgreSQL.
 * Сервером служит PGlite: это тот же Postgres, но без Docker.
 */
let database: Database;
let server: PGLiteSocketServer;
let pglite: PGlite;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer().once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

const coffee = { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 640 };

beforeAll(async () => {
  pglite = await PGlite.create();
  const port = await freePort();
  server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 10 });
  await server.start();

  database = createPostgresDatabase(`postgres://postgres@127.0.0.1:${port}/postgres`);
  await waitForDatabase(database);
  await migrate(database);
});

afterAll(async () => {
  await database.close();
  await server.stop();
  await pglite.close();
});

describe('драйвер pg', () => {
  it('применяет миграции', async () => {
    const rows = await database.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );

    expect(rows.map((r) => r.name)).toEqual([
      '0001_init.sql',
      '0002_soft_delete.sql',
      '0003_auth.sql',
      '0004_currency.sql',
      '0005_edit_delete.sql',
      '0006_preferences.sql',
      '0007_password_source.sql',
      '0008_profile.sql',
    ]);
  });

  it('возвращает даты строкой, а числа — числами', async () => {
    const repository = new PostgresExpenseRepository(database);

    const saved = await repository.insertPending(
      database,
      { ...coffee, date: '2026-01-01' },
      'misha',
    );

    expect(saved.date).toBe('2026-01-01');
    expect(saved.amount).toBe(640);
    expect(await repository.countQueue()).toBeTypeOf('number');
  });

  it('работает с массивами в запросах: статусы, импорт через unnest', async () => {
    const repository = new PostgresExpenseRepository(database);
    const a = await repository.insertPending(database, { ...coffee, name: 'А' }, 'misha');
    const b = await repository.insertPending(database, { ...coffee, name: 'Б' }, 'misha');

    await repository.markWriting(database, [a.id, b.id]);
    await repository.markSynced(database, [a.id]);
    const imported = await repository.importFromExcel(database, [
      { ...coffee, name: 'Импорт 1' },
      { ...coffee, name: 'Импорт 2', amount: 10 },
    ]);

    expect(imported).toBe(2);
    expect((await repository.findById(a.id))?.excelStatus).toBe('synced');
    expect((await repository.findById(b.id))?.excelStatus).toBe('writing');
    const names = (await repository.listForReconcile(database)).map((e) => e.name);
    expect(names.slice(-2)).toEqual(['Импорт 1', 'Импорт 2']);
  });

  it('откатывает транзакцию при ошибке', async () => {
    const repository = new PostgresExpenseRepository(database);
    const before = await repository.listForReconcile(database);

    await expect(
      database.transaction(async (tx) => {
        await repository.insertPending(tx, { ...coffee, name: 'Откат' }, 'misha');
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await repository.listForReconcile(database)).toHaveLength(before.length);
  });

  it('хранит и возвращает jsonb-результат синхронизации', async () => {
    const state = new SyncStateRepository(database);
    const result = okResult({
      imported: 5,
      skippedRows: [{ row: 3, reason: 'некорректная дата' }],
    });

    await state.save(result);
    await state.save({ ...result, imported: 6 });

    expect(await state.get()).toEqual({ ...result, imported: 6 });
  });
});

describe('идемпотентность на настоящем драйвере', () => {
  it('одновременные запросы с одним ключом создают один расход', async () => {
    const repository = new PostgresExpenseRepository(database);
    const idempotency = new IdempotencyService(database);
    const request = { userId: 'misha', key: 'concurrent-key-1', payload: coffee };
    const work = (tx: Parameters<typeof repository.insertPending>[0]) =>
      repository.insertPending(tx, { ...coffee, name: 'Параллельный' }, 'misha');

    const results = await Promise.all([
      idempotency.run(request, work),
      idempotency.run(request, work),
      idempotency.run(request, work),
    ]);

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.value.id)).size).toBe(1);
    const stored = await database.query('SELECT 1 FROM expenses WHERE name = $1', ['Параллельный']);
    expect(stored).toHaveLength(1);
  });

  it('ошибка в работе откатывает и ключ', async () => {
    const idempotency = new IdempotencyService(database);

    await expect(
      idempotency.run({ userId: 'misha', key: 'failing-key-01', payload: coffee }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(
      await database.query(`SELECT 1 FROM idempotency_keys WHERE key = 'failing-key-01'`),
    ).toHaveLength(0);
  });
});

describe('недоступная база', () => {
  it('waitForDatabase сдаётся по таймауту с понятной ошибкой подключения', async () => {
    const unreachable = createPostgresDatabase('postgres://x@127.0.0.1:1/x');
    let retries = 0;

    await expect(
      waitForDatabase(unreachable, { timeoutMs: 300, intervalMs: 50, onRetry: () => retries++ }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });

    expect(retries).toBeGreaterThan(0);
    await unreachable.close();
  });

  it('waitForDatabase дожидается, пока база запустится', async () => {
    const port = await freePort();
    const late = createPostgresDatabase(`postgres://postgres@127.0.0.1:${port}/postgres`);
    const latePglite = await PGlite.create();
    const lateServer = new PGLiteSocketServer({ db: latePglite, port, host: '127.0.0.1' });

    const waiting = waitForDatabase(late, { timeoutMs: 5000, intervalMs: 50 });
    setTimeout(() => void lateServer.start(), 200);
    await expect(waiting).resolves.toBeUndefined();

    await late.close();
    await lateServer.stop();
    await latePglite.close();
  });
});
