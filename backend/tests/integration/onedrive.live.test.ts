import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RcloneOneDriveService } from '../../src/services/onedrive.service.ts';
import { CliRcloneClient } from '../../src/services/onedrive/cli-client.ts';
import { RcdRcloneClient } from '../../src/services/onedrive/rcd-client.ts';
import { RcloneDaemon } from '../../src/services/onedrive/rcd-daemon.ts';

/**
 * Works with the real OneDrive, so it only runs when explicitly requested:
 *   RUN_ONEDRIVE_TESTS=1 npm test
 * Uses a separate file and never touches the working Расходы-dev.xlsx.
 */
const enabled = process.env.RUN_ONEDRIVE_TESTS === '1';
const REMOTE = process.env.ONEDRIVE_REMOTE ?? 'onedrive';
const TEST_PATH = process.env.ONEDRIVE_TEST_FILE_PATH ?? 'Документы/expenses-tracker-test.xlsx';
const FIXTURE = new URL('../fixtures/expenses-dev.xlsx', import.meta.url).pathname;
const TIMEOUT_MS = 60_000;

const rclone = (...args: string[]) => execFileSync('rclone', args, { stdio: 'ignore' });

describe.skipIf(!enabled)('OneDrive через rclone (live)', { timeout: 120_000 }, () => {
  beforeAll(() => rclone('copyto', FIXTURE, `${REMOTE}:${TEST_PATH}`));
  afterAll(() => rclone('deletefile', `${REMOTE}:${TEST_PATH}`));

  const daemon = new RcloneDaemon();
  afterAll(() => daemon.stop());

  describe.each([
    ['постоянный процесс (rcd)', () => new RcdRcloneClient(daemon, TIMEOUT_MS)],
    ['CLI', () => new CliRcloneClient({ timeoutMs: TIMEOUT_MS })],
  ])('%s', (_name, createClient) => {
    const createService = (filePath = TEST_PATH) =>
      new RcloneOneDriveService({ remote: REMOTE, filePath, client: createClient() });

    it('скачивает файл и возвращает версию', async () => {
      const file = await createService().downloadFile();

      expect(file.size).toBeGreaterThan(0);
      expect((await readFile(file.localPath)).length).toBe(file.size);
    });

    it('загружает изменённый файл и сверяет хеш', async () => {
      const service = createService();
      const downloaded = await service.downloadFile();
      const modified = join(await mkdtemp(join(tmpdir(), 'live-')), 'modified.xlsx');
      await copyFile(downloaded.localPath, modified);
      await writeFile(modified, Buffer.concat([await readFile(modified), Buffer.from('x')]));

      const started = performance.now();
      const result = await service.uploadFile(modified, downloaded.version);
      console.log(
        `  загрузка с проверками: ${((performance.now() - started) / 1000).toFixed(1)} c`,
      );

      expect(result.version).not.toBe(downloaded.version);
      expect((await service.getFileMetadata()).version).toBe(result.version);
    });

    it('отклоняет загрузку по устаревшей версии', async () => {
      await expect(createService().uploadFile(FIXTURE, 'stale-version')).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
      });
    });

    it('сообщает об отсутствующем файле', async () => {
      const missing = createService('Документы/нет-такого.xlsx');

      await expect(missing.getFileMetadata()).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
      await expect(missing.downloadFile()).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    });
  });
});
