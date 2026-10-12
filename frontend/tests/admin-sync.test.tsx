import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from '../src/features/admin/pages/AdminPage.tsx';
import { SyncIndicator } from '../src/features/sync/components/SyncIndicator.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });

const ADMIN = {
  username: 'root',
  displayName: 'Админ',
  card: 'Админ',
  canEdit: false,
  timezone: 'Asia/Yerevan',
  role: null,
  isAdmin: true,
};

let sync: { configured: boolean; enabled: boolean };
let putResponse: (() => Response) | undefined;
let requests: { method: string; url: string; body?: Record<string, unknown> }[];

const statusBody = () => {
  const now = new Date();
  return {
    enabled: sync.enabled,
    queued: 0,
    running: false,
    intervalMs: 300_000,
    nextRunAt: new Date(now.getTime() + 60_000).toISOString(),
    serverTime: now.toISOString(),
  };
};

beforeEach(() => {
  sync = { configured: true, enabled: true };
  putResponse = undefined;
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/auth/me') return ok({ user: ADMIN });
      if (url === '/api/admin/groups') return ok([]);
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD'], rates: [] });
      if (url === '/api/sync/status') return ok(statusBody());
      if (url === '/api/admin/sync' && method === 'PUT') {
        if (putResponse) return putResponse();
        sync = { ...sync, enabled: body.enabled };
        return ok(sync);
      }
      if (url === '/api/admin/sync') return ok(sync);
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function renderAdmin() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin']}>
        {/* The header icon is rendered next to the page, as in the app shell */}
        <SyncIndicator />
        <Routes>
          <Route path="admin" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Синхронизация с Excel' });
  return userEvent.setup();
}

const section = () =>
  screen.getByRole('heading', { name: 'Синхронизация с Excel' }).closest('section')!;
const puts = () => requests.filter((r) => r.method === 'PUT' && r.url === '/api/admin/sync');
const syncStatusCalls = () => requests.filter((r) => r.url === '/api/sync/status').length;

describe('раздел «Синхронизация с Excel»', () => {
  it('показывает состояние: включена, выключена, не настроена', async () => {
    await renderAdmin();
    expect(await within(section()).findByText('Включена')).toBeInTheDocument();
    expect(
      within(section()).getByRole('button', { name: 'Выключить синхронизацию' }),
    ).toBeEnabled();
  });

  it('выключенная: «Выключена» и кнопка «Включить»', async () => {
    sync = { configured: true, enabled: false };
    await renderAdmin();

    expect(await within(section()).findByText('Выключена')).toBeInTheDocument();
    expect(within(section()).getByRole('button', { name: 'Включить синхронизацию' })).toBeEnabled();
  });

  it('не настроена на сервере: включить нельзя', async () => {
    sync = { configured: false, enabled: false };
    await renderAdmin();

    expect(await within(section()).findByText('Не настроена на сервере')).toBeInTheDocument();
    expect(
      within(section()).getByRole('button', { name: 'Включить синхронизацию' }),
    ).toBeDisabled();
    expect(within(section()).getByText(/Включить нельзя/)).toBeInTheDocument();
  });

  it('выключение идёт через подтверждение и отправляет enabled: false', async () => {
    const person = await renderAdmin();
    await within(section()).findByText('Включена');

    await person.click(within(section()).getByRole('button', { name: 'Выключить синхронизацию' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('перестанет обращаться к OneDrive');
    expect(puts()).toHaveLength(0);
    await person.click(within(dialog).getByRole('button', { name: 'Выключить' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: false });
    expect(await within(section()).findByText('Выключена')).toBeInTheDocument();
  });

  it('включение тоже с подтверждением и enabled: true', async () => {
    sync = { configured: true, enabled: false };
    const person = await renderAdmin();
    await within(section()).findByText('Выключена');

    await person.click(within(section()).getByRole('button', { name: 'Включить синхронизацию' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('снова начнёт сверять Excel с базой');
    await person.click(within(dialog).getByRole('button', { name: 'Включить' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: true });
  });

  it('ошибка 409 показывается сообщением сервера', async () => {
    putResponse = () =>
      json(
        { success: false, error: { code: 'EXCEL_NOT_CONFIGURED', message: 'Excel не настроен' } },
        409,
      );
    sync = { configured: true, enabled: false };
    const person = await renderAdmin();
    await within(section()).findByText('Выключена');

    await person.click(within(section()).getByRole('button', { name: 'Включить синхронизацию' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Включить' }),
    );

    expect(await within(section()).findByRole('alert')).toHaveTextContent('Excel не настроен');
  });
});

describe('значок синхронизации в шапке', () => {
  it('после выключения значок сразу исчезает, опрос прекращается', async () => {
    const person = await renderAdmin();
    expect(
      await screen.findByRole('button', { name: /Синхронизация с Excel/ }),
    ).toBeInTheDocument();

    await person.click(await screen.findByRole('button', { name: 'Выключить синхронизацию' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Выключить' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Синхронизация с Excel/ })).toBeNull(),
    );
    // Nothing else is rendered in its place: no placeholder, no spinner
    expect(screen.queryByText('…')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    const before = syncStatusCalls();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(syncStatusCalls()).toBe(before);
  });

  it('при включении после выключения значок возвращается без перезагрузки', async () => {
    sync = { configured: true, enabled: false };
    const person = await renderAdmin();
    await within(section()).findByText('Выключена');
    expect(screen.queryByRole('button', { name: /Синхронизация с Excel/ })).toBeNull();

    await person.click(within(section()).getByRole('button', { name: 'Включить синхронизацию' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Включить' }),
    );

    expect(
      await screen.findByRole('button', { name: /Синхронизация с Excel/ }),
    ).toBeInTheDocument();
  });
});
