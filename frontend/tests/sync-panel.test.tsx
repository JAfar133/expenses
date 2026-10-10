import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SyncPanel } from '../src/features/sync/components/SyncPanel.tsx';
import { formatCountdown } from '../src/features/sync/hooks/useCountdown.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const state = (overrides: Record<string, unknown> = {}) => {
  const serverTime = new Date();
  return {
    queued: 0,
    running: false,
    intervalMs: 300_000,
    // До следующего запуска ровно 4 минуты 32 секунды по часам сервера
    nextRunAt: new Date(serverTime.getTime() + 272_000).toISOString(),
    serverTime: serverTime.toISOString(),
    lastResult: {
      startedAt: '2026-10-10T10:00:00.000Z',
      finishedAt: '2026-10-10T10:00:05.000Z',
      status: 'ok',
      imported: 3,
      written: 2,
      queued: 0,
      diverged: 0,
      skipped: 0,
    },
    ...overrides,
  };
};

type Responder = () => Response | Promise<Response>;

let statusResponse: Mock<Responder>;
let syncResponse: Mock<Responder>;

beforeEach(() => {
  statusResponse = vi.fn<Responder>(() => json({ success: true, data: state() }));
  syncResponse = vi.fn<Responder>(() => json({ success: true, data: state() }));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/sync/status') return statusResponse();
      if (url === '/api/sync' && init?.method === 'POST') return syncResponse();
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SyncPanel />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('formatCountdown', () => {
  it.each([
    [272_000, '4:32'],
    [59_000, '0:59'],
    [300_000, '5:00'],
    [1, '0:01'],
  ])('%i мс → %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe('таймер и результат', () => {
  it('показывает время до следующей синхронизации по часам сервера', async () => {
    renderPanel();

    expect(await screen.findByText(/Следующая через 4:3[12]/)).toBeInTheDocument();
  });

  it('показывает итоги последней синхронизации', async () => {
    renderPanel();

    await screen.findByText(/Следующая через/);
    expect(screen.getByText('Добавлено из Excel').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Записано в Excel').nextSibling).toHaveTextContent('2');
  });

  it('скрывает расхождения и пропущенные строки, когда их нет', async () => {
    renderPanel();

    await screen.findByText(/Следующая через/);
    expect(screen.queryByText('Есть в базе, но нет в Excel')).not.toBeInTheDocument();
    expect(screen.queryByText('Пропущено строк Excel')).not.toBeInTheDocument();
  });

  it('показывает расхождения и пропущенные строки с пояснением', async () => {
    statusResponse.mockImplementation(() =>
      json({
        success: true,
        data: state({ lastResult: { ...state().lastResult, diverged: 2, skipped: 1 } }),
      }),
    );
    renderPanel();

    expect(await screen.findByText('Есть в базе, но нет в Excel')).toBeInTheDocument();
    expect(screen.getByText(/сохранены/)).toBeInTheDocument();
    expect(screen.getByText('Пропущено строк Excel')).toBeInTheDocument();
  });
});

describe('очередь и ошибки', () => {
  it('показывает, сколько записей ждёт Excel', async () => {
    statusResponse.mockImplementation(() => json({ success: true, data: state({ queued: 3 }) }));
    renderPanel();

    expect(await screen.findByText('В очереди на запись в Excel: 3')).toBeInTheDocument();
  });

  it('объясняет, почему записи не ушли в Excel', async () => {
    statusResponse.mockImplementation(() =>
      json({
        success: true,
        data: state({
          queued: 1,
          lastResult: {
            ...state().lastResult,
            status: 'locked',
            error: {
              code: 'FILE_LOCKED',
              message: 'Файл открыт в Excel. Записи ждут в очереди и будут добавлены автоматически',
            },
          },
        }),
      }),
    );
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Файл открыт в Excel');
  });

  it('сообщает, если состояние не получено', async () => {
    statusResponse.mockImplementation(() =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500),
    );
    renderPanel();

    expect(
      await screen.findByText('Не удалось получить состояние синхронизации'),
    ).toBeInTheDocument();
  });
});

describe('ручной запуск', () => {
  it('кнопка запускает синхронизацию и обновляет данные', async () => {
    const user = renderPanel();
    syncResponse.mockImplementation(() =>
      json({
        success: true,
        data: state({ lastResult: { ...state().lastResult, imported: 7 } }),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Синхронизировать' }));

    await waitFor(() => expect(syncResponse).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText('Добавлено из Excel').nextSibling).toHaveTextContent('7'),
    );
  });

  it('на время синхронизации кнопка заблокирована, двойное нажатие даёт один запрос', async () => {
    let finish!: () => void;
    syncResponse.mockImplementation(
      () =>
        new Promise((resolve) => (finish = () => resolve(json({ success: true, data: state() })))),
    );
    const user = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Синхронизировать' }));
    const busy = await screen.findByRole('button', { name: 'Синхронизируем…' });
    await user.click(busy);

    expect(busy).toBeDisabled();
    expect(syncResponse).toHaveBeenCalledTimes(1);

    finish();
    await screen.findByRole('button', { name: 'Синхронизировать' });
  });

  it('кнопка недоступна, пока синхронизация идёт по расписанию', async () => {
    statusResponse.mockImplementation(() =>
      json({ success: true, data: state({ running: true, nextRunAt: null }) }),
    );
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Синхронизируем…' })).toBeDisabled();
    expect(screen.getByText('Синхронизация выполняется…')).toBeInTheDocument();
  });

  it('сообщает, если запустить синхронизацию не удалось', async () => {
    syncResponse.mockImplementation(() =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500),
    );
    const user = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Синхронизировать' }));

    expect(await screen.findByText('Не удалось запустить синхронизацию')).toBeInTheDocument();
  });
});
