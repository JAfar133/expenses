import { execFile } from 'node:child_process';
import { OneDriveError, classifyStderr } from './errors.ts';

export interface RcloneResult {
  stdout: string;
}

/** Запускает rclone с аргументами. Выделено в тип, чтобы подменять в тестах. */
export type RcloneRunner = (args: string[]) => Promise<RcloneResult>;

export interface RcloneRunnerOptions {
  binary?: string;
  configPath?: string;
  timeoutMs: number;
}

/**
 * Запуск через execFile: аргументы передаются массивом и не проходят через shell,
 * поэтому инъекция команд невозможна.
 */
export function createRcloneRunner(options: RcloneRunnerOptions): RcloneRunner {
  const { binary = 'rclone', configPath, timeoutMs } = options;
  const env = configPath ? { ...process.env, RCLONE_CONFIG: configPath } : process.env;

  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { env, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) {
            return resolve({ stdout });
          }

          // Процесс убит по таймауту
          if ('killed' in error && error.killed) {
            return reject(new OneDriveError('TIMEOUT', `rclone timed out after ${timeoutMs}ms`));
          }

          reject(new OneDriveError(classifyStderr(stderr), summarize(stderr), { cause: error }));
        },
      );
    });
}

/** Последняя строка stderr обычно содержит причину; весь вывод в сообщение не тащим. */
function summarize(stderr: string): string {
  const lines = stderr.trim().split('\n');
  return lines[lines.length - 1] || 'rclone failed';
}
