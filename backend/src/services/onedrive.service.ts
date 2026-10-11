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
  /** Name of the remote in the rclone config, e.g. `onedrive` */
  remote: string;
  /** Path to the file inside OneDrive, e.g. `Документы/Расходы-dev.xlsx` */
  filePath: string;
  client: RcloneClient;
  tempDir?: string;
  /** Number of download attempts on transient errors */
  downloadAttempts?: number;
  retryBaseDelayMs?: number;
}

/**
 * File version is a hash of its content. The version of a downloaded copy is computed from the downloaded
 * bytes, so it always matches exactly what we modify, even if the file on
 * OneDrive changed right during the download.
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
   * Downloads the file into a new temporary directory. Reading is safe to repeat,
   * so transient errors lead to a retry with an increasing pause.
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
   * Uploads the file over the remote one if the latter has not changed since the download.
   * A write is never retried automatically: after a failure it is unknown whether it was applied.
   *
   * A small race window remains between the version check and the upload (an rclone limitation).
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

  /** Compares the file hash on OneDrive with the local one to verify integrity. */
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
