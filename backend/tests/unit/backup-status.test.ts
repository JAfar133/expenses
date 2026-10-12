import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupStatusService } from '../../src/modules/admin/backup-status.service.ts';

const NOW = Date.parse('2026-10-12T12:00:00Z');
let dir: string;

const service = (overrides: Partial<ConstructorParameters<typeof BackupStatusService>[0]> = {}) =>
  new BackupStatusService({ dir, maxAgeHours: 26, now: () => NOW, ...overrides });

const write = (name: string, value: unknown) =>
  writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
const run = (at: string, ok = true, error = '') => write('backup-last-run.json', { at, ok, error });
const success = (at: string, remote = 'ok') =>
  write('backup-last-success.json', {
    at,
    file: 'expenses-2026-10-12-0300.sql.gz',
    sizeBytes: 12_345,
    remote,
  });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backup-status-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('состояние бэкапа', () => {
  it('свежая копия и удачный запуск: всё в порядке', async () => {
    await run('2026-10-12T03:00:05Z');
    await success('2026-10-12T03:00:04Z');

    const view = await service().view();

    expect(view).toMatchObject({
      configured: true,
      state: 'ok',
      lastSuccess: { file: 'expenses-2026-10-12-0300.sql.gz', sizeBytes: 12_345, remote: 'ok' },
      lastRun: { ok: true },
    });
    expect(view.ageHours).toBeCloseTo(9, 0);
  });

  it('копии старше порога: устарела', async () => {
    await run('2026-10-10T03:00:05Z');
    await success('2026-10-10T03:00:04Z');

    expect((await service().view()).state).toBe('stale');
  });

  it('порог настраивается', async () => {
    await run('2026-10-12T03:00:05Z');
    await success('2026-10-12T03:00:04Z');

    expect((await service({ maxAgeHours: 6 }).view()).state).toBe('stale');
  });

  it('последний запуск завершился ошибкой: ошибка, даже если хорошая копия есть', async () => {
    await success('2026-10-12T03:00:04Z');
    await run('2026-10-12T11:00:00Z', false, 'dump_failed');

    const view = await service().view();

    expect(view.state).toBe('failed');
    expect(view.lastRun).toMatchObject({ ok: false, error: 'dump_failed' });
    expect(view.lastSuccess).not.toBeNull();
  });

  it('копия не ушла в OneDrive: запуск отмечен ошибкой, локальная копия остаётся хорошей', async () => {
    await success('2026-10-12T03:00:04Z', 'failed');
    await run('2026-10-12T03:00:05Z', false, 'upload_failed');

    const view = await service().view();

    expect(view.state).toBe('failed');
    expect(view.lastSuccess?.remote).toBe('failed');
  });

  it('только запуск без удачной копии: устарела', async () => {
    await run('2026-10-12T03:00:05Z');

    expect((await service().view()).state).toBe('stale');
  });

  it('файлов нет или они испорчены: нет данных, не ошибка приложения', async () => {
    expect((await service().view()).state).toBe('unknown');
    await write('backup-last-run.json', '{ not json');
    await write('backup-last-success.json', '{"at": 5}');

    expect((await service().view()).state).toBe('unknown');
  });

  it('папка не задана на сервере: не настроено', async () => {
    expect(await service({ dir: '' }).view()).toMatchObject({
      configured: false,
      state: 'unknown',
      lastRun: null,
    });
  });
});
