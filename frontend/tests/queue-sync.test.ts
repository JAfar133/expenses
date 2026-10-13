import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/shared/api/http.ts';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import {
  classifyError,
  isQueueable,
  runQueueSync,
  syncOnce,
  type SyncDeps,
} from '../src/features/offline-queue/model/queue-sync.ts';
import { queued } from './helpers/queue-fixtures.ts';

const network = () => new ApiError(0, 'NETWORK', 'Нет соединения с сервером');
const http = (status: number, message = 'Сообщение сервера') =>
  new ApiError(status, 'CODE', message);

function makeDeps(overrides: Partial<SyncDeps> = {}) {
  const send = vi.fn(async (_expense: unknown, key: string) => ({ id: `srv-${key}` }));
  const uploadPhoto = vi.fn(async () => ({ success: true as const, data: undefined }));
  const deps = { store: queueStore, send, uploadPhoto, ...overrides } as unknown as SyncDeps;
  return { deps, send, uploadPhoto };
}

const ids = async () => (await queueStore.list()).map((item) => item.id);

describe('классификация ошибок отправки', () => {
  it.each([
    [network(), 'retry'],
    [http(502), 'retry'],
    [http(503), 'retry'],
    [http(504), 'retry'],
    [http(429), 'retry'],
    [http(500), 'retry'],
    [new Error('что-то'), 'retry'],
    [http(401), 'auth'],
    [http(400), 'reject'],
    [http(403), 'reject'],
    [http(404), 'reject'],
    [http(409), 'reject'],
    [http(422), 'reject'],
  ])('%o → %s', (error, kind) => {
    expect(classifyError(error)).toBe(kind);
  });

  it('в очередь при сохранении попадают только сетевая ошибка и 502/503/504', () => {
    expect(isQueueable(network())).toBe(true);
    for (const status of [502, 503, 504]) expect(isQueueable(http(status))).toBe(true);
    for (const status of [400, 401, 403, 409, 422, 429, 500]) {
      expect(isQueueable(http(status))).toBe(false);
    }
    expect(isQueueable(new Error('x'))).toBe(false);
  });
});

describe('отправка очереди', () => {
  it('шлёт по одному, строго по порядку createdAt, и удаляет отправленное', async () => {
    await queueStore.add(queued('3', { createdAt: 300 }));
    await queueStore.add(queued('1', { createdAt: 100 }));
    await queueStore.add(queued('2', { createdAt: 200 }));
    const { deps, send } = makeDeps();

    const outcome = await syncOnce(deps);

    expect(send.mock.calls.map(([, key]) => key)).toEqual(['1', '2', '3']);
    expect(outcome).toEqual({ created: 3 });
    expect(await ids()).toEqual([]);
  });

  it('отправляет ровно то, что лежало в записи, с её ключом идемпотентности', async () => {
    const item = queued('k-1');
    await queueStore.add(item);
    const { deps, send } = makeDeps();

    await syncOnce(deps);

    expect(send).toHaveBeenCalledWith(item.expense, 'k-1');
  });

  it('не берёт записи со статусом failed', async () => {
    await queueStore.add(queued('1', { status: 'failed', error: 'x' }));
    await queueStore.add(queued('2'));
    const { deps, send } = makeDeps();

    await syncOnce(deps);

    expect(send.mock.calls.map(([, key]) => key)).toEqual(['2']);
    expect(await ids()).toEqual(['1']);
  });

  it('сетевая ошибка: останавливается, запись остаётся pending, остальные не трогаются', async () => {
    await queueStore.add(queued('1'));
    await queueStore.add(queued('2'));
    const send = vi.fn().mockRejectedValue(network());
    const { deps } = makeDeps({ send } as never);

    const outcome = await syncOnce(deps);

    expect(outcome).toEqual({ created: 0, stoppedBy: 'retry' });
    expect(send).toHaveBeenCalledTimes(1);
    const items = await queueStore.list();
    expect(items.map((item) => item.status)).toEqual(['pending', 'pending']);
    expect(items[0]!.attempts).toBe(1);
    expect(items[1]!.attempts).toBe(0);
  });

  it.each([502, 503, 504, 429])('ответ %i: остановка и повтор позже', async (status) => {
    await queueStore.add(queued('1'));
    const { deps } = makeDeps({ send: vi.fn().mockRejectedValue(http(status)) } as never);

    expect((await syncOnce(deps)).stoppedBy).toBe('retry');
    expect((await queueStore.list())[0]!.status).toBe('pending');
  });

  it('повтор после сетевой ошибки идёт с тем же ключом идемпотентности', async () => {
    await queueStore.add(queued('same-key'));
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValueOnce({ id: 'srv-1' });
    const { deps } = makeDeps({ send } as never);

    await syncOnce(deps);
    await syncOnce(deps);

    expect(send.mock.calls.map(([, key]) => key)).toEqual(['same-key', 'same-key']);
    expect(await ids()).toEqual([]);
  });

  it('401: останавливается, ничего не помечает, очередь цела', async () => {
    await queueStore.add(queued('1'));
    await queueStore.add(queued('2'));
    const send = vi.fn().mockRejectedValue(http(401));
    const { deps } = makeDeps({ send } as never);

    const outcome = await syncOnce(deps);

    expect(outcome.stoppedBy).toBe('auth');
    expect(send).toHaveBeenCalledTimes(1);
    expect((await queueStore.list()).map((item) => [item.id, item.status, item.error])).toEqual([
      ['1', 'pending', undefined],
      ['2', 'pending', undefined],
    ]);
  });

  it.each([400, 403, 404, 409, 422])(
    '%i: запись помечается failed с сообщением сервера, остальные продолжают',
    async (status) => {
      await queueStore.add(queued('1'));
      await queueStore.add(queued('2'));
      const send = vi
        .fn()
        .mockRejectedValueOnce(http(status, 'Такой карты нет'))
        .mockResolvedValueOnce({ id: 'srv-2' });
      const { deps } = makeDeps({ send } as never);

      const outcome = await syncOnce(deps);

      expect(outcome).toEqual({ created: 1 });
      const [left] = await queueStore.list();
      expect(left).toMatchObject({ id: '1', status: 'failed', error: 'Такой карты нет' });
      expect(await ids()).toEqual(['1']);
    },
  );

  it('failed не отправляется автоматически второй раз', async () => {
    await queueStore.add(queued('1'));
    const send = vi.fn().mockRejectedValue(http(422));
    const { deps } = makeDeps({ send } as never);

    await syncOnce(deps);
    await syncOnce(deps);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('фото уходит после расхода на его серверный id, затем запись удаляется', async () => {
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    await queueStore.add(queued('1', { photo }));
    const { deps, send, uploadPhoto } = makeDeps();

    await syncOnce(deps);

    expect(send.mock.invocationCallOrder[0]).toBeLessThan(uploadPhoto.mock.invocationCallOrder[0]!);
    expect(uploadPhoto).toHaveBeenCalledWith('srv-1', expect.any(Blob));
    expect(await ids()).toEqual([]);
  });

  it('сбой фото после успеха расхода: расход не теряется и не шлётся снова, запись помечена «фото не загрузилось»', async () => {
    await queueStore.add(queued('1', { photo: new Blob(['x'], { type: 'image/jpeg' }) }));
    await queueStore.add(queued('2'));
    const uploadPhoto = vi.fn().mockRejectedValue(http(422, 'Не JPEG'));
    const { deps, send } = makeDeps({ uploadPhoto } as never);

    const outcome = await syncOnce(deps);

    expect(outcome.created).toBe(2);
    const [left] = await queueStore.list();
    expect(left).toMatchObject({
      id: '1',
      status: 'failed',
      photoFailed: true,
      serverId: 'srv-1',
    });
    // The next record was not blocked
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('ручной повтор после сбоя фото шлёт только фото, расход второй раз не создаётся', async () => {
    await queueStore.add(
      queued('1', {
        photo: new Blob(['x'], { type: 'image/jpeg' }),
        status: 'pending',
        serverId: 'srv-1',
        photoFailed: false,
      }),
    );
    const { deps, send, uploadPhoto } = makeDeps();

    await syncOnce(deps);

    expect(send).not.toHaveBeenCalled();
    expect(uploadPhoto).toHaveBeenCalledWith('srv-1', expect.any(Blob));
    expect(await ids()).toEqual([]);
  });

  it('сетевая ошибка при загрузке фото: расход уже принят, запись остаётся pending с serverId', async () => {
    await queueStore.add(queued('1', { photo: new Blob(['x'], { type: 'image/jpeg' }) }));
    const { deps } = makeDeps({ uploadPhoto: vi.fn().mockRejectedValue(network()) } as never);

    const outcome = await syncOnce(deps);

    expect(outcome).toEqual({ created: 1, stoppedBy: 'retry' });
    expect((await queueStore.list())[0]).toMatchObject({ status: 'pending', serverId: 'srv-1' });
  });
});

describe('разбор чека после отправки очереди', () => {
  const photo = () => new Blob(['x'], { type: 'image/jpeg' });

  it('запись с фото и признаком parse: после загрузки фото запускается разбор расхода', async () => {
    await queueStore.add(queued('1', { photo: photo(), parse: true }));
    const parse = vi.fn();
    const { deps, uploadPhoto } = makeDeps({ parse } as never);

    await syncOnce(deps);

    expect(parse).toHaveBeenCalledWith('srv-1');
    expect(parse.mock.invocationCallOrder[0]).toBeGreaterThan(
      uploadPhoto.mock.invocationCallOrder[0]!,
    );
  });

  it('без признака parse разбор не запускается', async () => {
    await queueStore.add(queued('1', { photo: photo() }));
    const parse = vi.fn();
    const { deps } = makeDeps({ parse } as never);

    await syncOnce(deps);

    expect(parse).not.toHaveBeenCalled();
  });

  it('сбой фото: разбирать нечего, разбор не запускается', async () => {
    await queueStore.add(queued('1', { photo: photo(), parse: true }));
    const parse = vi.fn();
    const { deps } = makeDeps({
      parse,
      uploadPhoto: vi.fn().mockRejectedValue(http(422, 'Не JPEG')),
    } as never);

    await syncOnce(deps);

    expect(parse).not.toHaveBeenCalled();
  });

  it('повтор только фото (расход уже принят): после загрузки тоже разбор', async () => {
    await queueStore.add(queued('1', { photo: photo(), parse: true, serverId: 'srv-9' }));
    const parse = vi.fn();
    const { deps, send } = makeDeps({ parse } as never);

    await syncOnce(deps);

    expect(send).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledWith('srv-9');
  });
});

describe('замок: нет параллельной отправки', () => {
  it('второй запуск во время первого ничего не делает', async () => {
    await queueStore.add(queued('1'));
    let release: () => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          release = () => resolve({ id: 'srv-1' });
        }),
    );
    const { deps } = makeDeps({ send } as never);

    const first = runQueueSync(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    const second = await runQueueSync(deps);
    release();
    await first;

    expect(second).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('после завершения следующий запуск возможен', async () => {
    const { deps } = makeDeps();
    await runQueueSync(deps);

    await queueStore.add(queued('1'));
    const outcome = await runQueueSync(deps);

    expect(outcome?.created).toBe(1);
  });

  it('использует Web Lock, если он есть; без выданного замка не отправляет', async () => {
    await queueStore.add(queued('1'));
    const request = vi.fn(
      async (_name: string, _options: unknown, cb: (lock: unknown) => unknown) => cb(null),
    );
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    const { deps, send } = makeDeps();

    const outcome = await runQueueSync(deps);

    expect(request).toHaveBeenCalledWith(
      'expenses-queue-sync',
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(outcome).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('с выданным Web Lock отправка проходит', async () => {
    await queueStore.add(queued('1'));
    const request = vi.fn(async (_n: string, _o: unknown, cb: (lock: unknown) => unknown) =>
      cb({}),
    );
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    const { deps, send } = makeDeps();

    await runQueueSync(deps);

    expect(send).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('при известном отсутствии сети не пытается отправлять', async () => {
    await queueStore.add(queued('1'));
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { deps, send } = makeDeps();

    expect(await runQueueSync(deps)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
