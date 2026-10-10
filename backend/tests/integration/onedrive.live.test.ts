import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RcloneOneDriveService } from '../../src/services/onedrive.service.ts';
import { createRcloneRunner } from '../../src/services/onedrive/rclone-runner.ts';

/**
 * Работает с настоящим OneDrive, поэтому запускается только явно:
 *   RUN_ONEDRIVE_TESTS=1 npm test
 * Использует отдельный файл и никогда не трогает рабочий Расходы-dev.xlsx.
 */
const enabled = process.env.RUN_ONEDRIVE_TESTS === '1';
const REMOTE = process.env.ONEDRIVE_REMOTE ?? 'onedrive';
const TEST_PATH = process.env.ONEDRIVE_TEST_FILE_PATH ?? 'Документы/expenses-tracker-test.xlsx';
const FIXTURE = new URL('../fixtures/expenses-dev.xlsx', import.meta.url).pathname;

describe.skipIf(!enabled)('OneDrive через rclone (live)', { timeout: 60_000 }, () => {
  const run = createRcloneRunner({ timeoutMs: 60_000 });
  const service = new RcloneOneDriveService({ remote: REMOTE, filePath: TEST_PATH, run });

  beforeAll(async () => {
    await run(['copyto', FIXTURE, `${REMOTE}:${TEST_PATH}`]);
  });

  afterAll(async () => {
    await run(['deletefile', `${REMOTE}:${TEST_PATH}`]);
  });

  it('скачивает файл и возвращает версию', async () => {
    const file = await service.downloadFile();

    expect(file.size).toBeGreaterThan(0);
    expect((await readFile(file.localPath)).length).toBe(file.size);
  });

  it('загружает изменённый файл и сверяет хеш', async () => {
    const downloaded = await service.downloadFile();
    const modified = join(await mkdtemp(join(tmpdir(), 'live-')), 'modified.xlsx');
    await copyFile(downloaded.localPath, modified);
    await writeFile(modified, Buffer.concat([await readFile(modified), Buffer.from('x')]));

    const result = await service.uploadFile(modified, downloaded.version);

    expect(result.version).not.toBe(downloaded.version);
  });

  it('отклоняет загрузку по устаревшей версии', async () => {
    await expect(service.uploadFile(FIXTURE, 'stale:version')).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });

  it('сообщает об отсутствующем файле', async () => {
    const missing = new RcloneOneDriveService({
      remote: REMOTE,
      filePath: 'Документы/нет-такого.xlsx',
      run,
    });

    await expect(missing.getFileMetadata()).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});
