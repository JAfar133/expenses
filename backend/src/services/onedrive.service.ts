import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OneDriveError } from './onedrive/errors.ts';
import type { RcloneRunner } from './onedrive/rclone-runner.ts';
import type {
  DownloadedFile,
  OneDriveService,
  RemoteFileMetadata,
  UploadResult,
} from './onedrive/types.ts';

export { OneDriveError } from './onedrive/errors.ts';
export type {
  OneDriveService,
  DownloadedFile,
  RemoteFileMetadata,
  UploadResult,
} from './onedrive/types.ts';

export interface RcloneOneDriveOptions {
  /** Имя remote в конфигурации rclone, например `onedrive` */
  remote: string;
  /** Путь к файлу внутри OneDrive, например `Документы/Расходы-dev.xlsx` */
  filePath: string;
  run: RcloneRunner;
  tempDir?: string;
  /** Количество попыток скачивания при временных ошибках */
  downloadAttempts?: number;
  retryBaseDelayMs?: number;
}

interface RcloneListItem {
  Size: number;
  ModTime: string;
  Hashes?: { quickxor?: string };
}

export class RcloneOneDriveService implements OneDriveService {
  private readonly remotePath: string;
  private readonly tempDir: string;
  private readonly downloadAttempts: number;
  private readonly retryBaseDelayMs: number;

  constructor(private readonly options: RcloneOneDriveOptions) {
    this.remotePath = `${options.remote}:${options.filePath}`;
    this.tempDir = options.tempDir ?? join(tmpdir(), 'expenses-tracker');
    this.downloadAttempts = options.downloadAttempts ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  }

  async getFileMetadata(): Promise<RemoteFileMetadata> {
    const { stdout } = await this.options.run([
      'lsjson',
      '--hash',
      '--no-mimetype',
      this.remotePath,
    ]);

    const [item] = JSON.parse(stdout) as RcloneListItem[];
    if (!item) {
      throw new OneDriveError('FILE_NOT_FOUND', `File not found: ${this.remotePath}`);
    }

    const hash = item.Hashes?.quickxor ?? '';
    return {
      size: item.Size,
      modifiedAt: item.ModTime,
      hash,
      version: `${hash}:${item.Size}:${item.ModTime}`,
    };
  }

  /**
   * Скачивает файл в новый временный каталог. Чтение безопасно повторять,
   * поэтому временные ошибки и смена версии во время скачивания приводят к повтору.
   */
  async downloadFile(): Promise<DownloadedFile> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.downloadAttempts; attempt++) {
      try {
        return await this.downloadOnce();
      } catch (error) {
        lastError = error;
        if (!isRetryableRead(error) || attempt === this.downloadAttempts) {
          throw error;
        }
        await sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }

  /**
   * Загружает файл поверх удалённого, если тот не менялся с момента скачивания.
   * Запись никогда не повторяется автоматически: после сбоя неизвестно, применилась ли она.
   *
   * Между проверкой версии и загрузкой остаётся небольшое окно гонки (ограничение rclone).
   */
  async uploadFile(localPath: string, expectedVersion: string): Promise<UploadResult> {
    const current = await this.getFileMetadata();
    if (current.version !== expectedVersion) {
      throw new OneDriveError('VERSION_CONFLICT', 'Remote file changed since it was downloaded');
    }

    await this.options.run(['copyto', localPath, this.remotePath]);

    return { version: await this.verifyUpload(localPath) };
  }

  private async downloadOnce(): Promise<DownloadedFile> {
    const before = await this.getFileMetadata();

    await mkdir(this.tempDir, { recursive: true });
    const directory = await mkdtemp(join(this.tempDir, 'op-'));
    const localPath = join(directory, 'source.xlsx');
    await this.options.run(['copyto', this.remotePath, localPath]);

    const after = await this.getFileMetadata();
    if (after.version !== before.version) {
      throw new OneDriveError('VERSION_CONFLICT', 'Remote file changed during download');
    }

    return { localPath, size: (await stat(localPath)).size, version: after.version };
  }

  /** Сверяет хеш загруженного файла с хешем локального, чтобы убедиться в целостности. */
  private async verifyUpload(localPath: string): Promise<string> {
    const { stdout } = await this.options.run(['hashsum', 'quickxor', localPath]);
    const localHash = stdout.trim().split(/\s+/)[0];
    const remote = await this.getFileMetadata();

    if (!localHash || remote.hash !== localHash) {
      throw new OneDriveError(
        'UPLOAD_NOT_VERIFIED',
        'Uploaded file hash does not match the local file',
      );
    }
    return remote.version;
  }
}

function isRetryableRead(error: unknown): boolean {
  return error instanceof OneDriveError && (error.isTransient || error.code === 'VERSION_CONFLICT');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
