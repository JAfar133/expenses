import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { OneDriveError } from './errors.ts';

export interface RcdEndpoint {
  url: string;
  authorization: string;
}

export interface RcdEndpointProvider {
  endpoint(): Promise<RcdEndpoint>;
}

export interface RcloneDaemonOptions {
  binary?: string;
  configPath?: string;
  startupTimeoutMs?: number;
  logger?: { info: (message: string) => void; warn: (message: string) => void };
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 3_000;

/**
 * Постоянный процесс `rclone rcd`, который держит соединения и кеш OneDrive между запросами.
 *
 * - слушает только 127.0.0.1 на случайном свободном порту;
 * - логин и пароль генерируются при каждом запуске и передаются через окружение,
 *   поэтому не видны в списке процессов;
 * - если процесс упал, следующий запрос запустит его заново.
 */
export class RcloneDaemon implements RcdEndpointProvider {
  private child?: ChildProcess;
  private starting?: Promise<RcdEndpoint>;
  private stopped = false;

  constructor(private readonly options: RcloneDaemonOptions = {}) {}

  endpoint(): Promise<RcdEndpoint> {
    if (this.stopped) {
      return Promise.reject(new OneDriveError('RCLONE_UNAVAILABLE', 'rclone daemon is stopped'));
    }
    this.starting ??= this.start().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return;
    }

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const forced = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
    await exited;
    clearTimeout(forced);
  }

  private async start(): Promise<RcdEndpoint> {
    const { binary = 'rclone', configPath, logger } = this.options;
    const port = await findFreePort();
    const user = 'expenses-tracker';
    const password = randomBytes(24).toString('hex');

    const child = spawn(binary, ['rcd', '--rc-addr', `127.0.0.1:${port}`], {
      env: {
        ...process.env,
        RCLONE_RC_USER: user,
        RCLONE_RC_PASS: password,
        ...(configPath ? { RCLONE_CONFIG: configPath } : {}),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;

    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
        this.starting = undefined;
      }
      if (!this.stopped) {
        logger?.warn(
          `rclone rcd exited (code=${code}, signal=${signal}); will restart on next use`,
        );
      }
    });
    // Не оставляем процесс сиротой при штатном завершении Node
    process.once('exit', () => child.kill());

    const endpoint: RcdEndpoint = {
      url: `http://127.0.0.1:${port}`,
      authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    };

    try {
      await waitUntilReady(
        endpoint,
        child,
        this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      );
    } catch (error) {
      child.kill();
      const reason = error instanceof Error ? error.message : String(error);
      throw new OneDriveError(
        'RCLONE_UNAVAILABLE',
        `rclone rcd failed to start: ${reason}. ${stderrTail.trim().split('\n').pop() ?? ''}`.trim(),
      );
    }

    logger?.info(`rclone rcd started on 127.0.0.1:${port}`);
    return endpoint;
  }
}

async function waitUntilReady(endpoint: RcdEndpoint, child: ChildProcess, timeoutMs: number) {
  const exited = new Promise<never>((_, reject) => {
    child.once('error', (error) => reject(error));
    child.once('exit', (code) => reject(new Error(`process exited with code ${code}`)));
  });

  const poll = async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${endpoint.url}/core/version`, {
          method: 'POST',
          headers: { Authorization: endpoint.authorization },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) return;
      } catch {
        // Процесс ещё не начал слушать порт
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`no response within ${timeoutMs}ms`);
  };

  await Promise.race([poll(), exited]);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
