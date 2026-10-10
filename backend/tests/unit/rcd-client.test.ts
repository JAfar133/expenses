import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RcdRcloneClient } from '../../src/services/onedrive/rcd-client.ts';

interface RecordedRequest {
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}

/** 'hang' — сервер принимает запрос, но не отвечает */
type Handler = (request: RecordedRequest) => { status?: number; body: unknown } | 'hang';

let server: Server | undefined;

afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

/** Поднимает поддельный rclone rcd и возвращает клиент к нему. */
async function createClient(handler: Handler, timeoutMs = 2000) {
  const requests: RecordedRequest[] = [];

  server = createServer(async (req, res) => {
    const request = await readRequest(req);
    requests.push(request);
    const reply = handler(request);
    if (reply === 'hang') return;

    const { status = 200, body } = reply;
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const provider = {
    endpoint: async () => ({ url: `http://127.0.0.1:${port}`, authorization: 'Basic abc' }),
  };
  return { client: new RcdRcloneClient(provider, timeoutMs), requests };
}

async function readRequest(req: IncomingMessage): Promise<RecordedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return {
    path: req.url ?? '',
    authorization: req.headers.authorization,
    body: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
  };
}

const file = { fs: 'onedrive:', path: 'Документы/Расходы.xlsx' };

describe('stat', () => {
  it('запрашивает хеш и возвращает метаданные, передавая авторизацию', async () => {
    const { client, requests } = await createClient(() => ({
      body: { item: { Size: 10, ModTime: 't', Hashes: { quickxor: 'abc' } } },
    }));

    expect(await client.stat(file)).toEqual({ size: 10, modifiedAt: 't', hash: 'abc' });
    expect(requests[0]).toMatchObject({
      path: '/operations/stat',
      authorization: 'Basic abc',
      body: { fs: 'onedrive:', remote: 'Документы/Расходы.xlsx', opt: { showHash: true } },
    });
  });

  it('возвращает undefined, если файла нет', async () => {
    const { client } = await createClient(() => ({ body: { item: null } }));

    expect(await client.stat(file)).toBeUndefined();
  });
});

describe('копирование', () => {
  it('скачивает: источник — OneDrive, приёмник — локальный каталог', async () => {
    const { client, requests } = await createClient(() => ({ body: {} }));

    await client.download(file, '/tmp/op-1/source.xlsx');

    expect(requests[0]!.body).toEqual({
      srcFs: 'onedrive:',
      srcRemote: 'Документы/Расходы.xlsx',
      dstFs: '/tmp/op-1',
      dstRemote: 'source.xlsx',
    });
  });

  it('загружает: источник — локальный файл, приёмник — OneDrive', async () => {
    const { client, requests } = await createClient(() => ({ body: {} }));

    await client.upload('/tmp/op-1/result.xlsx', file);

    expect(requests[0]!.body).toEqual({
      srcFs: '/tmp/op-1',
      srcRemote: 'result.xlsx',
      dstFs: 'onedrive:',
      dstRemote: 'Документы/Расходы.xlsx',
    });
  });
});

describe('hashLocal', () => {
  it('выбирает хеш нужного файла среди файлов каталога', async () => {
    const { client } = await createClient(() => ({
      body: { hashsum: ['1111  source.xlsx', '2222  result.xlsx'] },
    }));

    expect(await client.hashLocal('/tmp/op-1/result.xlsx')).toBe('2222');
  });

  it('падает, если хеша файла нет в ответе', async () => {
    const { client } = await createClient(() => ({ body: { hashsum: ['1111  other.xlsx'] } }));

    await expect(client.hashLocal('/tmp/op-1/result.xlsx')).rejects.toThrow(/No hash/);
  });
});

describe('ошибки', () => {
  it.each([
    [404, 'object not found', 'FILE_NOT_FOUND'],
    [500, 'HTTP error 423 (423 Locked) resourceLocked', 'FILE_LOCKED'],
    [500, 'HTTP error 429 Too Many Requests', 'RATE_LIMITED'],
    [500, 'oauth2: "invalid_grant"', 'AUTH_FAILED'],
    [500, 'something strange', 'UNKNOWN'],
  ])('%i «%s» → %s', async (status, error, code) => {
    const { client } = await createClient(() => ({ status, body: { error } }));

    await expect(client.upload('/tmp/x/a.xlsx', file)).rejects.toMatchObject({ code });
  });

  it('TIMEOUT, если rclone не отвечает', async () => {
    const { client } = await createClient(() => 'hang', 100);

    await expect(client.stat(file)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('RCLONE_UNAVAILABLE, если процесс недоступен', async () => {
    const client = new RcdRcloneClient(
      { endpoint: async () => ({ url: 'http://127.0.0.1:1', authorization: 'x' }) },
      1000,
    );

    await expect(client.stat(file)).rejects.toMatchObject({ code: 'RCLONE_UNAVAILABLE' });
  });
});
