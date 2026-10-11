import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OneDriveError } from '../../src/services/onedrive/errors.ts';
import type { DownloadedFile, OneDriveService } from '../../src/services/onedrive/types.ts';

const sha = (data: Buffer) => createHash('sha1').update(data).digest('hex');

/** In-memory OneDrive: the "remote" file is a buffer; the version is a content hash, as in the real service. */
export class FakeOneDrive implements OneDriveService {
  downloads = 0;
  uploads = 0;

  /** The file is open in Excel: uploads are rejected with 423 */
  locked = false;
  downloadError?: Error;
  /** The upload is applied but the response is lost (network dropped after the write) */
  failAfterUpload?: Error;
  /** The upload is not applied and fails with an error */
  failBeforeUpload?: Error;
  /** Called after download: simulates someone else's edit of the file while we work */
  afterDownload?: () => void;
  /** The upload starts and waits for this signal, so a cycle can be stopped at a chosen point */
  uploadGate?: Promise<void>;
  onUploadStart?: () => void;

  constructor(public remote: Buffer) {}

  async getFileMetadata() {
    return {
      size: this.remote.length,
      modifiedAt: '',
      hash: sha(this.remote),
      version: sha(this.remote),
    };
  }

  async downloadFile(): Promise<DownloadedFile> {
    if (this.downloadError) throw this.downloadError;
    this.downloads++;

    const directory = await mkdtemp(join(tmpdir(), 'fake-onedrive-'));
    const localPath = join(directory, 'source.xlsx');
    await writeFile(localPath, this.remote);
    const downloaded = { localPath, size: this.remote.length, version: sha(this.remote) };

    this.afterDownload?.();
    return downloaded;
  }

  async uploadFile(localPath: string, expectedVersion: string) {
    this.uploads++;
    this.onUploadStart?.();
    await this.uploadGate;
    if (this.locked) throw new OneDriveError('FILE_LOCKED', '423 Locked');
    if (this.failBeforeUpload) throw this.failBeforeUpload;
    if (sha(this.remote) !== expectedVersion) {
      throw new OneDriveError('VERSION_CONFLICT', 'Remote file changed');
    }

    this.remote = await readFile(localPath);
    if (this.failAfterUpload) throw this.failAfterUpload;
    return { version: sha(this.remote) };
  }
}
