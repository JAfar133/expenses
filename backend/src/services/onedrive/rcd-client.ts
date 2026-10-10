import { basename, dirname } from 'node:path';
import { classifyStderr, OneDriveError } from './errors.ts';
import type { RcdEndpointProvider } from './rcd-daemon.ts';
import {
  HASH_TYPE,
  type RcloneClient,
  type RemoteFile,
  type RemoteFileStat,
} from './rclone-client.ts';

interface RcItem {
  Size: number;
  ModTime: string;
  Hashes?: Record<string, string>;
}

/** Работает через HTTP-API постоянного `rclone rcd`: соединения с OneDrive переиспользуются. */
export class RcdRcloneClient implements RcloneClient {
  constructor(
    private readonly daemon: RcdEndpointProvider,
    private readonly timeoutMs: number,
  ) {}

  async stat(file: RemoteFile): Promise<RemoteFileStat | undefined> {
    const { item } = await this.call<{ item: RcItem | null }>('operations/stat', {
      fs: file.fs,
      remote: file.path,
      opt: { showHash: true, hashTypes: [HASH_TYPE], noMimeType: true },
    });

    if (!item) {
      return undefined;
    }
    return { size: item.Size, modifiedAt: item.ModTime, hash: item.Hashes?.[HASH_TYPE] };
  }

  async download(file: RemoteFile, localPath: string): Promise<void> {
    await this.call('operations/copyfile', {
      srcFs: file.fs,
      srcRemote: file.path,
      dstFs: dirname(localPath),
      dstRemote: basename(localPath),
    });
  }

  async upload(localPath: string, file: RemoteFile): Promise<void> {
    await this.call('operations/copyfile', {
      srcFs: dirname(localPath),
      srcRemote: basename(localPath),
      dstFs: file.fs,
      dstRemote: file.path,
    });
  }

  async hashLocal(localPath: string): Promise<string> {
    const { hashsum } = await this.call<{ hashsum: string[] }>('operations/hashsum', {
      fs: dirname(localPath),
      hashType: HASH_TYPE,
    });

    // Строки вида "<hash>  <имя файла>" для каждого файла каталога
    const name = basename(localPath);
    const hash = hashsum.find((line) => line.endsWith(`  ${name}`))?.split(/\s+/)[0];
    if (!hash) {
      throw new OneDriveError('UNKNOWN', `No hash returned for ${name}`);
    }
    return hash;
  }

  private async call<T = Record<string, never>>(operation: string, params: object): Promise<T> {
    const { url, authorization } = await this.daemon.endpoint();

    let response: Response;
    try {
      response = await fetch(`${url}/${operation}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw toTransportError(error, this.timeoutMs);
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      const message = body.error ?? `rclone rc responded with HTTP ${response.status}`;
      throw new OneDriveError(classifyStderr(message), message);
    }
    return body as T;
  }
}

/**
 * Не удалось получить ответ от rcd. При таймауте операция в rclone может ещё продолжаться,
 * поэтому для записи такая ошибка считается «результат неизвестен».
 */
function toTransportError(error: unknown, timeoutMs: number): OneDriveError {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new OneDriveError('TIMEOUT', `rclone rc timed out after ${timeoutMs}ms`);
  }
  return new OneDriveError('RCLONE_UNAVAILABLE', 'rclone daemon is not reachable', {
    cause: error,
  });
}
