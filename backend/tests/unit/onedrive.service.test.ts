import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyStderr, OneDriveError } from '../../src/services/onedrive/errors.ts';
import type {
  RcloneClient,
  RemoteFile,
  RemoteFileStat,
} from '../../src/services/onedrive/rclone-client.ts';
import { RcloneOneDriveService } from '../../src/services/onedrive.service.ts';

const sha = (content: string | Buffer) => createHash('sha1').update(content).digest('hex');

/** Поддельный rclone: «удалённый» файл хранится в памяти, обращения записываются в `calls`. */
class FakeRclone implements RcloneClient {
  calls: string[] = [];
  remoteContent: string | undefined = 'original';
  /** Ошибки, которые нужно выбросить при следующих вызовах соответствующих операций */
  failures: { stat?: Error[]; download?: Error[]; upload?: Error[] } = {};
  /** Подменяет содержимое удалённого файла после скачивания (имитация чужой правки) */
  afterDownload?: () => void;

  async stat(): Promise<RemoteFileStat | undefined> {
    this.calls.push('stat');
    const error = this.failures.stat?.shift();
    if (error) throw error;
    return this.remoteContent === undefined
      ? undefined
      : {
          size: this.remoteContent.length,
          modifiedAt: 't',
          hash: sha(this.remoteContent).toUpperCase(),
        };
  }

  async download(_file: RemoteFile, localPath: string) {
    this.calls.push('download');
    const error = this.failures.download?.shift();
    if (error) throw error;
    if (this.remoteContent === undefined) throw new OneDriveError('FILE_NOT_FOUND', 'not found');
    await writeFile(localPath, this.remoteContent);
    this.afterDownload?.();
  }

  async upload(localPath: string) {
    this.calls.push('upload');
    const error = this.failures.upload?.shift();
    if (error) throw error;
    this.remoteContent = (await readFile(localPath)).toString();
  }

  async hashLocal(localPath: string) {
    this.calls.push('hashLocal');
    return sha(await readFile(localPath));
  }
}

function createService(client: FakeRclone, downloadAttempts = 3) {
  return new RcloneOneDriveService({
    remote: 'onedrive',
    filePath: 'Документы/test.xlsx',
    client,
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
  it('версия — хеш содержимого в нижнем регистре', async () => {
    const metadata = await createService(new FakeRclone()).getFileMetadata();

    expect(metadata.hash).toBe(sha('original'));
    expect(metadata.version).toBe(sha('original'));
  });

  it('бросает FILE_NOT_FOUND, если файла нет', async () => {
    const client = new FakeRclone();
    client.remoteContent = undefined;

    await expect(createService(client).getFileMetadata()).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('не работает без хеша: проверить конфликт было бы нечем', async () => {
    const client = new FakeRclone();
    client.stat = async () => ({ size: 1, modifiedAt: 't' });

    await expect(createService(client).getFileMetadata()).rejects.toThrow(/hash is unavailable/);
  });
});

describe('downloadFile', () => {
  it('версия считается по скачанным байтам и не требует обращения к метаданным', async () => {
    const client = new FakeRclone();

    const file = await createService(client).downloadFile();

    expect(file.version).toBe(sha('original'));
    expect(file.size).toBe('original'.length);
    expect((await stat(file.localPath)).isFile()).toBe(true);
    expect(client.calls).toEqual(['download', 'hashLocal']);
  });

  it('версия соответствует скачанному, даже если файл на OneDrive изменился сразу после', async () => {
    const client = new FakeRclone();
    client.afterDownload = () => void (client.remoteContent = 'changed by someone');

    const file = await createService(client).downloadFile();

    expect(file.version).toBe(sha('original'));
  });

  it('повторяет скачивание при временной ошибке', async () => {
    const client = new FakeRclone();
    client.failures.download = [new OneDriveError('NETWORK', 'connection reset')];

    const file = await createService(client).downloadFile();

    expect(file.size).toBeGreaterThan(0);
    expect(client.calls.filter((call) => call === 'download')).toHaveLength(2);
  });

  it('повторяет скачивание, если процесс rclone временно недоступен', async () => {
    const client = new FakeRclone();
    client.failures.download = [new OneDriveError('RCLONE_UNAVAILABLE', 'daemon restarting')];

    await expect(createService(client).downloadFile()).resolves.toBeDefined();
  });

  it('не повторяет остальные ошибки', async () => {
    const client = new FakeRclone();
    client.failures.download = [new OneDriveError('AUTH_FAILED', 'invalid_grant')];

    await expect(createService(client).downloadFile()).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(client.calls.filter((call) => call === 'download')).toHaveLength(1);
  });

  it('прекращает попытки после лимита', async () => {
    const client = new FakeRclone();
    client.failures.download = [
      new OneDriveError('NETWORK', 'a'),
      new OneDriveError('NETWORK', 'b'),
    ];

    await expect(createService(client, 2).downloadFile()).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });

  it('не оставляет временный каталог после неудачи', async () => {
    const client = new FakeRclone();
    client.failures.download = [new OneDriveError('AUTH_FAILED', 'x')];
    let localPath = '';
    const original = client.download.bind(client);
    client.download = async (file, path) => {
      localPath = path;
      await writeFile(path, 'partial').catch(() => undefined);
      return original(file, path);
    };

    await expect(createService(client).downloadFile()).rejects.toThrow();
    await expect(stat(dirname(localPath))).rejects.toThrow();
  });
});

describe('uploadFile', () => {
  it('полный цикл: скачивание, проверка версии, загрузка и сверка хеша', async () => {
    const client = new FakeRclone();
    const service = createService(client);
    const file = await service.downloadFile();
    await writeFile(file.localPath, 'updated');
    client.calls = [];

    const result = await service.uploadFile(file.localPath, file.version);

    expect(result.version).toBe(sha('updated'));
    expect(client.remoteContent).toBe('updated');
    // Минимум обращений к OneDrive: проверка версии, загрузка, сверка
    expect(client.calls).toEqual(['stat', 'upload', 'hashLocal', 'stat']);
  });

  it('не загружает, если файл на OneDrive изменили с момента скачивания', async () => {
    const client = new FakeRclone();
    const service = createService(client);
    const file = await service.downloadFile();
    client.remoteContent = 'edited in Excel';
    client.calls = [];

    await expect(service.uploadFile(file.localPath, file.version)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect(client.calls).not.toContain('upload');
    expect(client.remoteContent).toBe('edited in Excel');
  });

  it('сообщает, если хеш после загрузки не совпал, и не повторяет запись', async () => {
    const client = new FakeRclone();
    const service = createService(client);
    const file = await service.downloadFile();
    client.upload = async () => {
      client.calls.push('upload');
      client.remoteContent = 'corrupted';
    };
    client.calls = [];

    await expect(service.uploadFile(file.localPath, file.version)).rejects.toMatchObject({
      code: 'UPLOAD_NOT_VERIFIED',
    });
    expect(client.calls.filter((call) => call === 'upload')).toHaveLength(1);
  });

  it('не повторяет запись при сетевой ошибке', async () => {
    const client = new FakeRclone();
    const service = createService(client);
    const file = await service.downloadFile();
    client.failures.upload = [new OneDriveError('NETWORK', 'reset')];
    client.calls = [];

    await expect(service.uploadFile(file.localPath, file.version)).rejects.toMatchObject({
      code: 'NETWORK',
    });
    expect(client.calls.filter((call) => call === 'upload')).toHaveLength(1);
  });

  it('передаёт ошибку блокировки файла', async () => {
    const client = new FakeRclone();
    const service = createService(client);
    const file = await service.downloadFile();
    client.failures.upload = [new OneDriveError('FILE_LOCKED', '423 Locked')];

    await expect(service.uploadFile(file.localPath, file.version)).rejects.toMatchObject({
      code: 'FILE_LOCKED',
    });
  });
});
