import { execFile } from 'node:child_process';
import { classifyStderr, OneDriveError } from './errors.ts';
import {
  HASH_TYPE,
  type RcloneClient,
  type RemoteFile,
  type RemoteFileStat,
} from './rclone-client.ts';

export interface CliRcloneClientOptions {
  binary?: string;
  configPath?: string;
  timeoutMs: number;
}

interface ListJsonItem {
  Size: number;
  ModTime: string;
  Hashes?: Record<string, string>;
}

/**
 * Каждая операция запускает новый процесс rclone. Медленно (4–5 с на команду из-за
 * установки соединения), зато не требует фонового процесса.
 *
 * Запуск через execFile: аргументы передаются массивом и не проходят через shell,
 * поэтому инъекция команд невозможна.
 */
export class CliRcloneClient implements RcloneClient {
  constructor(private readonly options: CliRcloneClientOptions) {}

  async stat(file: RemoteFile): Promise<RemoteFileStat | undefined> {
    let stdout: string;
    try {
      ({ stdout } = await this.run(['lsjson', '--hash', '--no-mimetype', toSpec(file)]));
    } catch (error) {
      if (error instanceof OneDriveError && error.code === 'FILE_NOT_FOUND') {
        return undefined;
      }
      throw error;
    }

    const [item] = JSON.parse(stdout) as ListJsonItem[];
    return item && { size: item.Size, modifiedAt: item.ModTime, hash: item.Hashes?.[HASH_TYPE] };
  }

  async download(file: RemoteFile, localPath: string): Promise<void> {
    await this.run(['copyto', '--retries', '1', toSpec(file), localPath]);
  }

  async upload(localPath: string, file: RemoteFile): Promise<void> {
    await this.run(['copyto', '--retries', '1', localPath, toSpec(file)]);
  }

  async hashLocal(localPath: string): Promise<string> {
    const { stdout } = await this.run(['hashsum', HASH_TYPE, localPath]);
    const hash = stdout.trim().split(/\s+/)[0];
    if (!hash) {
      throw new OneDriveError('UNKNOWN', `Empty hash for ${localPath}`);
    }
    return hash;
  }

  private run(args: string[]): Promise<{ stdout: string }> {
    const { binary = 'rclone', configPath, timeoutMs } = this.options;
    const env = configPath ? { ...process.env, RCLONE_CONFIG: configPath } : process.env;

    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { env, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) {
            return resolve({ stdout });
          }
          if ('killed' in error && error.killed) {
            return reject(new OneDriveError('TIMEOUT', `rclone timed out after ${timeoutMs}ms`));
          }
          reject(new OneDriveError(classifyStderr(stderr), lastLine(stderr), { cause: error }));
        },
      );
    });
  }
}

const toSpec = (file: RemoteFile) => `${file.fs}${file.path}`;

/** Последняя строка stderr обычно содержит причину; весь вывод в сообщение не тащим. */
function lastLine(stderr: string): string {
  const lines = stderr.trim().split('\n');
  return lines[lines.length - 1] || 'rclone failed';
}
