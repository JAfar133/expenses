import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import { ANALYTICS_KEY } from '../src/features/analytics/hooks/useAnalytics.ts';
import { BUDGETS_KEY } from '../src/features/budgets/hooks/useBudgets.ts';
import { NAME_SUGGESTIONS_KEY } from '../src/features/expenses/hooks/useNameSuggestions.ts';
import { SYNC_INTERVAL_MS } from '../src/features/offline-queue/hooks/useQueueSync.ts';
import {
  failure,
  fillForm,
  renderApp,
  server,
  setOnLine,
  setupOfflineHarness,
  submit,
} from './helpers/offline-harness.tsx';
import { queued } from './helpers/queue-fixtures.ts';

setupOfflineHarness();

const ids = async () => (await queueStore.list()).map((item) => item.id);
const postedNames = () => server.posts().map((request) => (request.body as { name: string }).name);

describe('отправка очереди в приложении', () => {
  it('при запуске отправляет то, что осталось с прошлого раза, по порядку, и очередь пустеет', async () => {
    await queueStore.add(queued('2', { createdAt: 2 }));
    await queueStore.add(queued('1', { createdAt: 1 }));

    await renderApp();

    await waitFor(async () => expect(await ids()).toEqual([]));
    expect(postedNames()).toEqual(['Расход 1', 'Расход 2']);
    expect(server.posts().map((request) => request.headers.get('Idempotency-Key'))).toEqual([
      '1',
      '2',
    ]);
  });

  it('после успеха обновляются расходы, аналитика, лимиты и подсказки; показано «Все расходы отправлены»', async () => {
    await queueStore.add(queued('1'));
    const { client } = await renderApp();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => expect(server.posts()).toHaveLength(1));

    await screen.findByText('Все расходы отправлены');
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    for (const key of [
      ANALYTICS_KEY,
      BUDGETS_KEY,
      NAME_SUGGESTIONS_KEY,
      ['expenses'],
      ['categories'],
    ]) {
      expect(keys).toContain(JSON.stringify(key));
    }
  });

  it('триггер «сеть появилась» (событие online)', async () => {
    server.postExpense = () => failure(503, 'x');
    await queueStore.add(queued('1'));
    await renderApp();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    const before = server.posts().length;
    server.postExpense = () =>
      new Response(JSON.stringify({ success: true, data: { id: 's' } }), { status: 201 });

    setOnLine(true);

    await waitFor(() => expect(server.posts().length).toBeGreaterThan(before));
    await waitFor(async () => expect(await ids()).toEqual([]));
  });

  it('триггер «приложение снова видно» (visibilitychange)', async () => {
    server.postExpense = () => failure(503, 'x');
    await queueStore.add(queued('1'));
    await renderApp();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    server.postExpense = () =>
      new Response(JSON.stringify({ success: true, data: { id: 's' } }), { status: 201 });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(async () => expect(await ids()).toEqual([]));
    expect(server.posts()).toHaveLength(2);
  });

  it('скрытая вкладка не отправляет', async () => {
    server.postExpense = () => failure(503, 'x');
    await queueStore.add(queued('1'));
    await renderApp();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(server.posts()).toHaveLength(1);
  });

  it('триггер «раз в 30 секунд, пока очередь не пуста»: таймер ставится на 30 с и шлёт снова', async () => {
    const timers = vi.spyOn(window, 'setInterval');
    server.postExpense = () => failure(503, 'x');
    await queueStore.add(queued('1'));
    await renderApp();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    await waitFor(() =>
      expect(timers.mock.calls.some(([, delay]) => delay === SYNC_INTERVAL_MS)).toBe(true),
    );
    server.postExpense = () =>
      new Response(JSON.stringify({ success: true, data: { id: 's' } }), { status: 201 });

    const tick = timers.mock.calls.find(
      ([, delay]) => delay === SYNC_INTERVAL_MS,
    )![0] as () => void;
    await act(async () => tick());

    await waitFor(async () => expect(await ids()).toEqual([]));
    expect(server.posts()).toHaveLength(2);
  });

  it('пустая очередь: таймер на 30 секунд не нужен', async () => {
    const timers = vi.spyOn(window, 'setInterval');

    await renderApp();

    expect(timers.mock.calls.some(([, delay]) => delay === SYNC_INTERVAL_MS)).toBe(false);
  });

  it('все триггеры сразу не приводят к параллельной отправке: запрос один', async () => {
    let release: () => void = () => undefined;
    server.postExpense = () =>
      new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            new Response(JSON.stringify({ success: true, data: { id: 's' } }), { status: 201 }),
          );
      });
    await queueStore.add(queued('1'));
    await renderApp();
    await waitFor(() => expect(server.posts()).toHaveLength(1));

    setOnLine(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    release();

    await waitFor(async () => expect(await ids()).toEqual([]));
    expect(server.posts()).toHaveLength(1);
  });

  it('сетевая ошибка: запись остаётся pending и уйдёт позже, баннер не мешает', async () => {
    server.postExpense = () => failure(504, 'Шлюз');
    await queueStore.add(queued('1'));

    await renderApp();

    await waitFor(() => expect(server.posts()).toHaveLength(1));
    expect(await ids()).toEqual(['1']);
    expect((await queueStore.list())[0]!.status).toBe('pending');
  });

  it('401: очередь цела, записи не помечены', async () => {
    server.postExpense = () => failure(401, 'Нужен вход', 'UNAUTHORIZED');
    await queueStore.add(queued('1'));
    await queueStore.add(queued('2'));

    await renderApp();

    await waitFor(() => expect(server.posts().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const items = await queueStore.list();
    expect(items.map((item) => [item.id, item.status])).toEqual([
      ['1', 'pending'],
      ['2', 'pending'],
    ]);
    // The second record was not tried
    expect(postedNames()).not.toContain('Расход 2');
  });

  it('422: запись становится failed с сообщением, остальные уходят', async () => {
    let calls = 0;
    server.postExpense = () =>
      ++calls === 1
        ? failure(422, 'Такой категории нет')
        : new Response(JSON.stringify({ success: true, data: { id: 's' } }), { status: 201 });
    await queueStore.add(queued('1'));
    await queueStore.add(queued('2'));

    await renderApp();

    await waitFor(async () => expect(await ids()).toEqual(['1']));
    expect((await queueStore.list())[0]).toMatchObject({
      status: 'failed',
      error: 'Такой категории нет',
    });
    expect(postedNames()).toEqual(['Расход 1', 'Расход 2']);
  });

  it('фото отправляется PUT-ом на id созданного расхода', async () => {
    await queueStore.add(queued('1', { photo: new Blob(['x'], { type: 'image/jpeg' }) }));

    await renderApp();

    await waitFor(async () => expect(await ids()).toEqual([]));
    expect(server.puts().map((request) => request.url)).toEqual(['/api/expenses/srv-1/receipt']);
    expect(server.puts()[0]!.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('сбой фото: расход не теряется, запись помечена, на странице видно статус', async () => {
    server.putReceipt = () => failure(422, 'Не JPEG');
    await queueStore.add(queued('1', { photo: new Blob(['x'], { type: 'image/jpeg' }) }));

    const { person } = await renderApp();

    await waitFor(async () =>
      expect((await queueStore.list())[0]).toMatchObject({ photoFailed: true, status: 'failed' }),
    );
    expect(server.posts()).toHaveLength(1);
    await person.click(await screen.findByRole('button', { name: /Не отправлено: 1/ }));
    expect(screen.getByText(/расход отправлен, фото не загрузилось/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Не отправлено' })).getByRole('button', {
        name: 'Повторить',
      }),
    ).toBeInTheDocument();
  });

  it('сквозной сценарий: без сети добавил два расхода, сеть вернулась, оба ушли по порядку, очередь пуста, баннер исчез', async () => {
    const { person } = await renderApp();
    server.network = false;
    setOnLine(false);
    expect(await screen.findByText(/Нет сети\. Расходы сохранятся/)).toBeInTheDocument();

    await fillForm(person, 'Первый', '100');
    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');
    await fillForm(person, 'Второй', '200');
    await submit(person);
    await screen.findByRole('button', { name: /Не отправлено: 2/ });
    expect(server.posts()).toHaveLength(0);
    const keys = (await queueStore.list()).map((item) => item.id);

    server.network = true;
    setOnLine(true);

    await waitFor(async () => expect(await ids()).toEqual([]));
    expect(postedNames()).toEqual(['Первый', 'Второй']);
    expect(server.posts().map((request) => request.headers.get('Idempotency-Key'))).toEqual(keys);
    expect(await screen.findByText('Все расходы отправлены')).toBeInTheDocument();
    expect(screen.queryByText(/Нет сети\. Расходы сохранятся/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Не отправлено/ })).toBeNull();
  });
});
