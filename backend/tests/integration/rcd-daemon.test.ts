import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RcdRcloneClient } from '../../src/services/onedrive/rcd-client.ts';
import { RcloneDaemon } from '../../src/services/onedrive/rcd-daemon.ts';

/**
 * Starts a real `rclone rcd`, but works only with local folders,
 * so OneDrive is not needed. Skipped if rclone is not installed.
 */
const hasRclone = (() => {
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasRclone)(
  'RcloneDaemon + RcdRcloneClient (локально)',
  { timeout: 30_000 },
  () => {
    const daemon = new RcloneDaemon();
    const client = new RcdRcloneClient(daemon, 10_000);
    let remoteDir: string;
    let localDir: string;

    beforeAll(async () => {
      remoteDir = await mkdtemp(join(tmpdir(), 'rcd-remote-'));
      localDir = await mkdtemp(join(tmpdir(), 'rcd-local-'));
      await writeFile(join(remoteDir, 'data.txt'), 'hello');
    });

    afterAll(async () => {
      await daemon.stop();
      await rm(remoteDir, { recursive: true, force: true });
      await rm(localDir, { recursive: true, force: true });
    });

    const remote = () => ({ fs: remoteDir, path: 'data.txt' });

    it('stat возвращает размер и хеш', async () => {
      const stat = await client.stat(remote());

      expect(stat?.size).toBe(5);
      expect(stat?.hash).toMatch(/^[0-9a-f]{40}$/);
    });

    it('stat для отсутствующего файла возвращает undefined', async () => {
      expect(await client.stat({ fs: remoteDir, path: 'nope.txt' })).toBeUndefined();
    });

    it('скачивает, считает локальный хеш, равный удалённому, и загружает обратно', async () => {
      const local = join(localDir, 'source.xlsx');

      await client.download(remote(), local);
      expect(await readFile(local, 'utf8')).toBe('hello');
      expect(await client.hashLocal(local)).toBe((await client.stat(remote()))?.hash);

      await writeFile(local, 'updated');
      await client.upload(local, remote());
      expect(await readFile(join(remoteDir, 'data.txt'), 'utf8')).toBe('updated');
      expect((await client.stat(remote()))?.hash).toBe(await client.hashLocal(local));
    });

    it('скачивание отсутствующего файла даёт FILE_NOT_FOUND', async () => {
      await expect(
        client.download({ fs: remoteDir, path: 'nope.txt' }, join(localDir, 'x.xlsx')),
      ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    });

    it('требует авторизацию: запрос без пароля отклоняется', async () => {
      const { url } = await daemon.endpoint();

      const response = await fetch(`${url}/core/version`, { method: 'POST' });

      expect(response.status).toBe(401);
    });

    it('слушает только localhost', async () => {
      const { url } = await daemon.endpoint();

      expect(new URL(url).hostname).toBe('127.0.0.1');
    });

    it('сам запускается заново после падения процесса', async () => {
      const before = await daemon.endpoint();
      process.kill(
        Number(
          execFileSync('lsof', ['-t', '-iTCP:' + new URL(before.url).port, '-sTCP:LISTEN'])
            .toString()
            .trim(),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));

      const stat = await client.stat(remote());

      expect(stat?.size).toBeGreaterThan(0);
      expect((await daemon.endpoint()).url).not.toBe(before.url);
    });

    it('после stop() новые запросы отклоняются', async () => {
      await daemon.stop();

      await expect(client.stat(remote())).rejects.toMatchObject({ code: 'RCLONE_UNAVAILABLE' });
    });
  },
);
