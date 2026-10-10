import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { classifyStderr, OneDriveError } from '../../src/services/onedrive/errors.ts';
import { RcloneOneDriveService } from '../../src/services/onedrive.service.ts';
import type { RcloneRunner } from '../../src/services/onedrive/rclone-runner.ts';

const listing = (hash: string, modTime = '2026-10-10T16:17:42Z') =>
  JSON.stringify([{ Size: 100, ModTime: modTime, Hashes: { quickxor: hash } }]);

function createService(run: RcloneRunner, downloadAttempts = 3) {
  return new RcloneOneDriveService({
    remote: 'onedrive',
    filePath: 'Документы/test.xlsx',
    run,
    tempDir: '/tmp/expenses-tracker-unit',
    downloadAttempts,
    retryBaseDelayMs: 1,
  });
}

describe('classifyStderr', () => {
  it.each([
    ['ERROR : error listing: directory not found', 'FILE_NOT_FOUND'],
    ['dial tcp: lookup graph.microsoft.com: no such host', 'NETWORK'],
    ['oauth2: "invalid_grant" "AADSTS70000"', 'AUTH_FAILED'],
    ['HTTP error 429 Too Many Requests', 'RATE_LIMITED'],
    ['insufficientStorage', 'QUOTA_EXCEEDED'],
    ['HTTP error 423 (423 Locked) resourceLocked', 'FILE_LOCKED'],
    ['something strange', 'UNKNOWN'],
  ])('%s -> %s', (stderr, code) => {
    expect(classifyStderr(stderr)).toBe(code);
  });
});

describe('getFileMetadata', () => {
  it('собирает версию из хеша, размера и времени изменения', async () => {
    const service = createService(async () => ({ stdout: listing('abc') }));

    const metadata = await service.getFileMetadata();

    expect(metadata.hash).toBe('abc');
    expect(metadata.version).toBe('abc:100:2026-10-10T16:17:42Z');
  });

  it('передаёт путь одним аргументом, без shell', async () => {
    const run = vi.fn<RcloneRunner>(async () => ({ stdout: listing('abc') }));

    await createService(run).getFileMetadata();

    expect(run).toHaveBeenCalledWith([
      'lsjson',
      '--hash',
      '--no-mimetype',
      'onedrive:Документы/test.xlsx',
    ]);
  });

  it('бросает FILE_NOT_FOUND на пустом списке', async () => {
    const service = createService(async () => ({ stdout: '[]' }));

    await expect(service.getFileMetadata()).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});

describe('downloadFile', () => {
  it('повторяет скачивание при временной ошибке', async () => {
    let copyCalls = 0;
    const run: RcloneRunner = async (args) => {
      if (args[0] === 'lsjson') return { stdout: listing('abc') };
      copyCalls++;
      if (copyCalls === 1) throw new OneDriveError('NETWORK', 'connection reset');
      await writeFile(args[2]!, 'xlsx-content');
      return { stdout: '' };
    };

    const file = await createService(run).downloadFile();

    expect(copyCalls).toBe(2);
    expect(file.size).toBe('xlsx-content'.length);
  });

  it('не повторяет нетемпорарные ошибки', async () => {
    const run = vi.fn<RcloneRunner>(async (args) => {
      if (args[0] === 'lsjson') throw new OneDriveError('AUTH_FAILED', 'invalid_grant');
      return { stdout: '' };
    });

    await expect(createService(run).downloadFile()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('считает конфликтом смену версии во время скачивания', async () => {
    let listCalls = 0;
    const run: RcloneRunner = async (args) => {
      if (args[0] !== 'lsjson') return { stdout: '' };
      return { stdout: listing(`hash-${listCalls++}`) };
    };

    await expect(createService(run, 1).downloadFile()).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });
});

describe('uploadFile', () => {
  it('не загружает, если версия на OneDrive изменилась', async () => {
    const run = vi.fn<RcloneRunner>(async () => ({ stdout: listing('new-hash') }));

    await expect(createService(run).uploadFile('/tmp/x.xlsx', 'old-version')).rejects.toMatchObject(
      {
        code: 'VERSION_CONFLICT',
      },
    );
    expect(run).not.toHaveBeenCalledWith(expect.arrayContaining(['copyto']));
  });

  it('загружает и сверяет хеш', async () => {
    const version = 'abc:100:2026-10-10T16:17:42Z';
    const run: RcloneRunner = async (args) => {
      if (args[0] === 'hashsum') return { stdout: 'abc  /tmp/x.xlsx\n' };
      return { stdout: args[0] === 'lsjson' ? listing('abc') : '' };
    };

    await expect(createService(run).uploadFile('/tmp/x.xlsx', version)).resolves.toEqual({
      version,
    });
  });

  it('сообщает, если хеш после загрузки не совпал, и не повторяет запись', async () => {
    const version = 'abc:100:2026-10-10T16:17:42Z';
    const run = vi.fn<RcloneRunner>(async (args) => {
      if (args[0] === 'hashsum') return { stdout: 'zzz  /tmp/x.xlsx\n' };
      return { stdout: args[0] === 'lsjson' ? listing('abc') : '' };
    });

    await expect(createService(run).uploadFile('/tmp/x.xlsx', version)).rejects.toMatchObject({
      code: 'UPLOAD_NOT_VERIFIED',
    });
    expect(run.mock.calls.filter(([args]) => args[0] === 'copyto')).toHaveLength(1);
  });

  it('не повторяет запись при сетевой ошибке', async () => {
    const version = 'abc:100:2026-10-10T16:17:42Z';
    const run = vi.fn<RcloneRunner>(async (args) => {
      if (args[0] === 'copyto') throw new OneDriveError('NETWORK', 'reset');
      return { stdout: listing('abc') };
    });

    await expect(createService(run).uploadFile('/tmp/x.xlsx', version)).rejects.toMatchObject({
      code: 'NETWORK',
    });
    expect(run.mock.calls.filter(([args]) => args[0] === 'copyto')).toHaveLength(1);
  });
});
