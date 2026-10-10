import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupService } from '../../src/infrastructure/backup/backup.service.ts';

let directory: string;
let source: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'backup-test-'));
  source = join(directory, 'source.xlsx');
  await writeFile(source, 'excel-content');
});

afterEach(() => rm(directory, { recursive: true, force: true }));

const createService = (now: Date, retentionDays = 30) =>
  new BackupService({
    dir: join(directory, 'backups'),
    retentionDays,
    timezone: 'Asia/Yerevan',
    now: () => now,
  });

describe('save', () => {
  it('кладёт копию в папку с датой по времени часового пояса', async () => {
    // 21:15:32 UTC = 01:15:32 следующего дня в Ереване (UTC+4)
    const service = createService(new Date('2026-10-10T21:15:32Z'));

    const path = await service.save(source);

    expect(path).toMatch(/backups\/2026-10-11\/expenses-01-15-32-[0-9a-f]{6}\.xlsx$/);
    expect(await readFile(path, 'utf8')).toBe('excel-content');
  });

  it('не затирает копии, сделанные в ту же секунду', async () => {
    const service = createService(new Date('2026-10-10T12:00:00Z'));

    const first = await service.save(source);
    const second = await service.save(source);

    expect(first).not.toBe(second);
  });

  it('доступна только владельцу', async () => {
    const path = await createService(new Date('2026-10-10T12:00:00Z')).save(source);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700);
  });

  it('падает, если исходного файла нет', async () => {
    await expect(createService(new Date()).save(join(directory, 'missing.xlsx'))).rejects.toThrow();
  });
});

describe('cleanup', () => {
  it('удаляет папки старше срока хранения и оставляет свежие и чужие', async () => {
    const root = join(directory, 'backups');
    for (const name of ['2026-09-01', '2026-09-09', '2026-09-10', '2026-10-09', 'notes']) {
      await mkdir(join(root, name), { recursive: true });
    }
    const service = createService(new Date('2026-10-10T12:00:00Z'), 30);

    const removed = await service.cleanup();

    // Граница: 2026-10-10 минус 30 дней = 2026-09-10 (эта папка ещё хранится)
    expect(removed).toBe(2);
    expect((await readdir(root)).sort()).toEqual(['2026-09-10', '2026-10-09', 'notes']);
  });

  it('не падает, если резервных копий ещё нет', async () => {
    expect(await createService(new Date()).cleanup()).toBe(0);
  });
});
