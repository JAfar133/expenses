import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OneDriveError } from './onedrive/errors.ts';
import type { RcloneClient, RemoteFile } from './onedrive/rclone-client.ts';
import type {
  DownloadedFile,
  OneDriveService,
  RemoteFileMetadata,
  UploadResult,
} from './onedrive/types.ts';

export { OneDriveError } from './onedrive/errors.ts';
export type {
  DownloadedFile,
  OneDriveService,
  RemoteFileMetadata,
  UploadResult,
} from './onedrive/types.ts';

export interface RcloneOneDriveOptions {
  /** Имя remote в конфигурации rclone, например `onedrive` */
  remote: string;
  /** Путь к файлу внутри OneDrive, например `Документы/Расходы-dev.xlsx` */
  filePath: string;
  client: RcloneClient;
  tempDir?: string;
  /** Количество попыток скачивания при временных ошибках */
  downloadAttempts?: number;
  retryBaseDelayMs?: number;
}

/**
 * Версия файла — хеш его содержимого. Версия скачанной копии считается по самим скачанным
 * байтам, поэтому она всегда точно соответствует тому, что мы изменяем, даже если файл на
 * OneDrive поменялся прямо во время скачивания.
 */
export class RcloneOneDriveService implements OneDriveService {
  private readonly client: RcloneClient;
  private readonly file: RemoteFile;
  private readonly tempDir: string;
  private readonly downloadAttempts: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: RcloneOneDriveOptions) {
    this.client = options.client;
    this.file = { fs: `${options.remote}:`, path: options.filePath };
    this.tempDir = options.tempDir ?? join(tmpdir(), 'expenses-tracker');
    this.downloadAttempts = options.downloadAttempts ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  }

  async getFileMetadata(): Promise<RemoteFileMetadata> {
    const remote = await this.client.stat(this.file);
    if (!remote) {
      throw new OneDriveError('FILE_NOT_FOUND', `File not found: ${this.file.fs}${this.file.path}`);
    }
    if (!remote.hash) {
      throw new OneDriveError('UNKNOWN', 'Remote file hash is unavailable');
    }

    const hash = normalizeHash(remote.hash);
    return { size: remote.size, modifiedAt: remote.modifiedAt, hash, version: hash };
  }

  /**
   * Скачивает файл в новый временный каталог. Чтение безопасно повторять,
   * поэтому временные ошибки приводят к повтору с нарастающей паузой.
   */
  async downloadFile(): Promise<DownloadedFile> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.downloadOnce();
      } catch (error) {
        const canRetry = error instanceof OneDriveError && error.isTransient;
        if (!canRetry || attempt >= this.downloadAttempts) {
          throw error;
        }
        await sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * Загружает файл поверх удалённого, если тот не менялся с момента скачивания.
   * Запись никогда не повторяется автоматически: после сбоя неизвестно, применилась ли она.
   *
   * Между проверкой версии и загрузкой остаётся небольшое окно гонки (ограничение rclone).
   */
  async uploadFile(localPath: string, expectedVersion: string): Promise<UploadResult> {
    const current = await this.getFileMetadata();
    if (current.version !== normalizeHash(expectedVersion)) {
      throw new OneDriveError('VERSION_CONFLICT', 'Remote file changed since it was downloaded');
    }

    await this.client.upload(localPath, this.file);

    return { version: await this.verifyUpload(localPath) };
  }

  private async downloadOnce(): Promise<DownloadedFile> {
    await mkdir(this.tempDir, { recursive: true });
    const directory = await mkdtemp(join(this.tempDir, 'op-'));

    try {
      const localPath = join(directory, 'source.xlsx');
      await this.client.download(this.file, localPath);

      const [hash, { size }] = await Promise.all([
        this.client.hashLocal(localPath),
        stat(localPath),
      ]);
      return { localPath, size, version: normalizeHash(hash) };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  /** Сверяет хеш файла на OneDrive с хешем локального, чтобы убедиться в целостности. */
  private async verifyUpload(localPath: string): Promise<string> {
    const [localHash, remote] = await Promise.all([
      this.client.hashLocal(localPath),
      this.getFileMetadata(),
    ]);

    if (remote.hash !== normalizeHash(localHash)) {
      throw new OneDriveError(
        'UPLOAD_NOT_VERIFIED',
        'Uploaded file hash does not match the local file',
      );
    }
    return remote.version;
  }
}

const normalizeHash = (hash: string) => hash.trim().toLowerCase();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
