import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SyncIndicator } from '../src/features/sync/components/SyncIndicator.tsx';
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

function renderIndicator(props: { failedVisibleMs?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SyncIndicator {...props} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** Единственная кнопка значка; её имя — полное описание состояния. */
const button = () => screen.getByRole('button');

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

describe('таймер', () => {
  it('показывает время до следующей синхронизации по часам сервера', async () => {
    renderIndicator();

    expect(await screen.findByText(/^4:3[12]$/)).toBeInTheDocument();
  });

  it('в описании для скринридера — полное состояние и подсказка', async () => {
    renderIndicator();

    await screen.findByText(/^4:3[12]$/);
    expect(button()).toHaveAccessibleName(/Синхронизация с Excel\. следующая через 4:3[12]/);
    expect(button()).toHaveAccessibleName(/нажмите, чтобы синхронизировать сейчас/);
    expect(button()).toHaveAttribute('data-tone', 'neutral');
  });

  it('пока идёт синхронизация, вместо таймера многоточие и кнопка недоступна', async () => {
    statusResponse.mockImplementation(() =>
      json({ success: true, data: state({ running: true, nextRunAt: null }) }),
    );
    renderIndicator();

    await waitFor(() => expect(button()).toHaveAccessibleName(/выполняется/));
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent('…');
  });
});

describe('очередь и ошибки', () => {
  it('показывает число записей в очереди и меняет цвет', async () => {
    statusResponse.mockImplementation(() => json({ success: true, data: state({ queued: 3 }) }));
    renderIndicator();

    await waitFor(() => expect(button()).toHaveTextContent('3'));
    expect(button()).toHaveAttribute('data-tone', 'warning');
    expect(button()).toHaveAccessibleName(/в очереди на запись: 3/);
  });

  it('если файл открыт в Excel, объясняет причину в описании', async () => {
    statusResponse.mockImplementation(() =>
      json({
        success: true,
        data: state({
          queued: 1,
          lastResult: {
            ...state().lastResult,
            status: 'locked',
            error: { code: 'FILE_LOCKED', message: 'Файл открыт в Excel. Записи ждут в очереди' },
          },
        }),
      }),
    );
    renderIndicator();

    await waitFor(() => expect(button()).toHaveAccessibleName(/Файл открыт в Excel/));
    expect(button()).toHaveAttribute('data-tone', 'warning');
  });

  it('при ошибке синхронизации значок красный', async () => {
    statusResponse.mockImplementation(() =>
      json({
        success: true,
        data: state({
          lastResult: {
            ...state().lastResult,
            status: 'error',
            error: { code: 'X', message: 'Ошибка при работе с OneDrive' },
          },
        }),
      }),
    );
    renderIndicator();

    await waitFor(() => expect(button()).toHaveAttribute('data-tone', 'error'));
    expect(button()).toHaveAccessibleName(/Ошибка при работе с OneDrive/);
  });

  it('если состояние не получено, показывает красный значок с восклицательным знаком', async () => {
    statusResponse.mockImplementation(() =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500),
    );
    renderIndicator();

    await waitFor(() => expect(button()).toHaveTextContent('!'));
    expect(button()).toHaveAttribute('data-tone', 'error');
    expect(button()).toBeDisabled();
  });
});

describe('ручной запуск', () => {
  it('нажатие запускает синхронизацию и обновляет состояние', async () => {
    const user = renderIndicator();
    syncResponse.mockImplementation(() => json({ success: true, data: state({ queued: 2 }) }));

    await screen.findByText(/^4:3[12]$/);
    await user.click(button());

    await waitFor(() => expect(syncResponse).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button()).toHaveTextContent('2'));
  });

  it('на время синхронизации значок заблокирован, двойное нажатие даёт один запрос', async () => {
    let finish!: () => void;
    syncResponse.mockImplementation(
      () =>
        new Promise((resolve) => (finish = () => resolve(json({ success: true, data: state() })))),
    );
    const user = renderIndicator();

    await screen.findByText(/^4:3[12]$/);
    await user.click(button());
    await waitFor(() => expect(button()).toBeDisabled());
    await user.click(button());

    expect(syncResponse).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('если запустить не удалось, значок краснеет с пояснением', async () => {
    syncResponse.mockImplementation(() =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500),
    );
    const user = renderIndicator();

    await screen.findByText(/^4:3[12]$/);
    await user.click(button());

    await waitFor(() => expect(button()).toHaveAttribute('data-tone', 'error'));
    expect(button()).toHaveAccessibleName(/не удалось запустить синхронизацию/);
  });
});

describe('сброс ошибки запуска', () => {
  it('красный после неудачного нажатия не остаётся навсегда', async () => {
    syncResponse.mockImplementation(() =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500),
    );
    const user = renderIndicator({ failedVisibleMs: 200 });
    await screen.findByText(/^4:3[12]$/);

    await user.click(button());
    await waitFor(() => expect(button()).toHaveAttribute('data-tone', 'error'));

    await waitFor(() => expect(button()).toHaveAttribute('data-tone', 'neutral'));
    expect(button()).not.toHaveAccessibleName(/не удалось запустить/);
  });

  it('запрос синхронизации уходит без Content-Type', async () => {
    const user = renderIndicator();
    await screen.findByText(/^4:3[12]$/);

    await user.click(button());

    await waitFor(() => expect(syncResponse).toHaveBeenCalled());
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/sync')!;
    expect(new Headers(call[1]?.headers).has('content-type')).toBe(false);
  });
});
