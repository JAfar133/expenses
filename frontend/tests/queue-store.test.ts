import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import { QueueUnavailableError } from '../src/features/offline-queue/model/queue-types.ts';
import { nextCreatedAt } from '../src/features/offline-queue/model/created-at.ts';
import { subscribeQueue } from '../src/features/offline-queue/model/queue-signal.ts';
import { queued } from './helpers/queue-fixtures.ts';

describe('хранилище очереди', () => {
  it('пустое, пока ничего не добавили', async () => {
    expect(await queueStore.list()).toEqual([]);
  });

  it('add и list: запись возвращается как была', async () => {
    await queueStore.add(queued('a1'));

    expect(await queueStore.list()).toEqual([queued('a1')]);
  });

  it('list отдаёт записи от старых к новым по createdAt, а не по ключу', async () => {
    await queueStore.add(queued('b', { createdAt: 30 }));
    await queueStore.add(queued('a', { createdAt: 20 }));
    await queueStore.add(queued('c', { createdAt: 10 }));

    expect((await queueStore.list()).map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('update меняет только переданные поля', async () => {
    await queueStore.add(queued('a1'));

    await queueStore.update('a1', { status: 'failed', error: 'Плохая карта', attempts: 2 });

    const [item] = await queueStore.list();
    expect(item).toMatchObject({ id: 'a1', status: 'failed', error: 'Плохая карта', attempts: 2 });
    expect(item!.expense.name).toBe('Расход a1');
  });

  it('update несуществующей записи ничего не создаёт', async () => {
    await queueStore.update('нет', { status: 'failed' });

    expect(await queueStore.list()).toEqual([]);
  });

  it('remove удаляет запись; удаление отсутствующей не ошибка', async () => {
    await queueStore.add(queued('a1'));
    await queueStore.add(queued('a2'));

    await queueStore.remove('a1');
    await queueStore.remove('нет');

    expect((await queueStore.list()).map((item) => item.id)).toEqual(['a2']);
  });

  it('фото сохраняется вместе с записью и читается как Blob с тем же типом и содержимым', async () => {
    const photo = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    await queueStore.add(queued('a1', { photo }));

    const [item] = await queueStore.list();

    expect(item!.photo).toBeInstanceOf(Blob);
    expect(item!.photo!.type).toBe('image/jpeg');
    expect(item!.photo!.size).toBe(photo.size);
  });

  it('запись с тем же ключом повторно не добавляется (ключ идемпотентности один)', async () => {
    await queueStore.add(queued('a1'));

    await expect(queueStore.add(queued('a1'))).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(await queueStore.list()).toHaveLength(1);
  });

  it('каждое изменение сообщает подписчикам', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeQueue(listener);

    await queueStore.add(queued('a1'));
    await queueStore.update('a1', { attempts: 1 });
    await queueStore.remove('a1');

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('IndexedDB нет (приватный режим): add сообщает об ошибке, а не теряет молча; list пуст по ошибке', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await expect(queueStore.add(queued('a1'))).rejects.toThrow(
      'Не удалось сохранить на устройстве, попробуйте позже',
    );
    await expect(queueStore.list()).rejects.toBeInstanceOf(QueueUnavailableError);
    vi.unstubAllGlobals();
    globalThis.indexedDB = new IDBFactory();
  });

  it('IndexedDB бросает при открытии: то же сообщение', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('SecurityError');
      },
    });

    await expect(queueStore.add(queued('a1'))).rejects.toBeInstanceOf(QueueUnavailableError);
    vi.unstubAllGlobals();
    globalThis.indexedDB = new IDBFactory();
  });
});

describe('время добавления', () => {
  it('строго растёт, даже если два расхода добавлены в одну миллисекунду', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15));
    const first = nextCreatedAt();
    const second = nextCreatedAt();
    vi.useRealTimers();

    expect(second).toBeGreaterThan(first);
  });
});
