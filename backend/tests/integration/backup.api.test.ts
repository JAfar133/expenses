import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { BackupStatusService } from '../../src/modules/admin/backup-status.service.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;
let dir: string;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), 'backup-api-'));
  const now = new Date().toISOString();
  await writeFile(
    join(dir, 'backup-last-run.json'),
    JSON.stringify({ at: now, ok: true, error: '' }),
  );
  await writeFile(
    join(dir, 'backup-last-success.json'),
    JSON.stringify({
      at: now,
      file: 'expenses-2026-10-12-0300.sql.gz',
      sizeBytes: 15251,
      remote: 'ok',
    }),
  );
  t = await createTestApp(database, {
    backupStatus: new BackupStatusService({ dir, maxAgeHours: 26 }),
  });
});
afterAll(async () => {
  await database.close();
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/admin/backup', () => {
  it('администратор видит состояние бэкапа', async () => {
    const response = await t.inject({ method: 'GET', url: '/api/admin/backup' }, 'misha');

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      configured: true,
      state: 'ok',
      lastSuccess: { file: 'expenses-2026-10-12-0300.sql.gz', sizeBytes: 15251, remote: 'ok' },
      lastRun: { ok: true },
      maxAgeHours: 26,
    });
  });

  it('участник и владелец без роли администратора получают 403', async () => {
    const response = await t.inject({ method: 'GET', url: '/api/admin/backup' }, 'nastya');

    expect(response.statusCode).toBe(403);
  });

  it('без входа 401', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/admin/backup' });

    expect(response.statusCode).toBe(401);
  });
});
