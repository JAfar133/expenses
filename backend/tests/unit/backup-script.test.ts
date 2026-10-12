import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** scripts/backup-db.sh with a fake `docker` (dump and rclone) and a throwaway backup folder. */
const exec = promisify(execFile);
const SCRIPT = new URL('../../../scripts/backup-db.sh', import.meta.url).pathname;
let sandbox: string;
let backups: string;

/** A dump that passes the checks: the expenses table and enough data that does not compress to nothing. */
const GOOD_DUMP = `COPY public.expenses (id) FROM stdin;\\n$(head -c 3000 /dev/urandom | base64)\\n`;

async function fakeDocker(behaviour: { dump: 'ok' | 'fail' | 'nodata'; upload?: 'ok' | 'fail' }) {
  const bin = join(sandbox, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, 'docker'),
    `#!/bin/bash
case "$*" in
  *pg_dump*)
    ${behaviour.dump === 'fail' ? 'echo boom >&2; exit 3' : behaviour.dump === 'nodata' ? 'echo "nothing here"' : `printf "${GOOD_DUMP}"`}
    ;;
  *rcat*) cat >/dev/null; ${behaviour.upload === 'fail' ? 'exit 4' : 'exit 0'} ;;
  *) exit 0 ;;
esac
`,
  );
  await chmod(join(bin, 'docker'), 0o755);
  return bin;
}

async function runScript(bin: string, env: Record<string, string> = {}) {
  // The script reads .env of the project folder: run it from a folder with its own .env
  const project = join(sandbox, 'project');
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, '.env'),
    env.ONEDRIVE_FILE_PATH ? 'ONEDRIVE_FILE_PATH=x.xlsx\n' : '',
  );
  await mkdir(join(project, 'scripts'), { recursive: true });
  const copy = join(project, 'scripts');
  await exec('cp', [SCRIPT, join(copy, 'backup-db.sh')]);
  await exec('cp', [SCRIPT.replace('backup-db.sh', 'lib.sh'), join(copy, 'lib.sh')]);
  return exec('bash', [join(copy, 'backup-db.sh')], {
    cwd: project,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_DIR: backups, ...env },
  }).then(
    () => 0,
    (error: { code: number }) => error.code,
  );
}

const json = async (name: string) => JSON.parse(await readFile(join(backups, name), 'utf8'));

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'backup-script-'));
  backups = join(sandbox, 'backups');
});
afterEach(() => rm(sandbox, { recursive: true, force: true }));

describe('скрипт бэкапа пишет состояние для приложения', () => {
  it('удачный запуск: копия, состояние последнего запуска и последней удачной копии', async () => {
    const code = await runScript(await fakeDocker({ dump: 'ok' }));

    expect(code).toBe(0);
    expect(await json('backup-last-run.json')).toMatchObject({ ok: true, error: '' });
    expect(await json('backup-last-success.json')).toMatchObject({ remote: 'off' });
    const success = await json('backup-last-success.json');
    expect(success.file).toMatch(/^expenses-.*\.sql\.gz$/);
    expect(success.sizeBytes).toBeGreaterThan(0);
  });

  it('сбой pg_dump: запуск отмечен ошибкой dump_failed, удачной копии нет', async () => {
    const code = await runScript(await fakeDocker({ dump: 'fail' }));

    expect(code).not.toBe(0);
    expect(await json('backup-last-run.json')).toMatchObject({ ok: false, error: 'dump_failed' });
    await expect(readFile(join(backups, 'backup-last-success.json'))).rejects.toThrow();
  });

  it('в дампе нет таблицы: verify_failed, копия не сохраняется', async () => {
    const code = await runScript(await fakeDocker({ dump: 'nodata' }));

    expect(code).not.toBe(0);
    expect(await json('backup-last-run.json')).toMatchObject({ ok: false, error: 'verify_failed' });
  });

  it('копия в OneDrive не загрузилась: локальная копия хорошая, запуск отмечен upload_failed', async () => {
    const code = await runScript(await fakeDocker({ dump: 'ok', upload: 'fail' }), {
      ONEDRIVE_FILE_PATH: 'x.xlsx',
    });

    expect(code).not.toBe(0);
    expect(await json('backup-last-run.json')).toMatchObject({ ok: false, error: 'upload_failed' });
    expect(await json('backup-last-success.json')).toMatchObject({ remote: 'failed' });
  });

  it('с загрузкой в OneDrive: remote ok', async () => {
    const code = await runScript(await fakeDocker({ dump: 'ok', upload: 'ok' }), {
      ONEDRIVE_FILE_PATH: 'x.xlsx',
    });

    expect(code).toBe(0);
    expect(await json('backup-last-success.json')).toMatchObject({ remote: 'ok' });
  });
});
