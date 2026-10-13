import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from '../src/features/admin/pages/AdminPage.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);

const ADMIN = {
  username: 'root',
  displayName: 'Админ',
  card: 'Админ',
  canEdit: false,
  timezone: 'Asia/Yerevan',
  role: null,
  isAdmin: true,
};

const EXPIRES = '2026-10-20T10:00:00.000Z';

let me: Record<string, unknown>;
let groups: Record<string, unknown>[];
let requests: { method: string; url: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  me = ADMIN;
  requests = [];
  groups = [
    {
      id: 1,
      name: 'Семья',
      reportingCurrency: 'AMD',
      disabled: false,
      owners: 1,
      members: 3,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 2,
      name: 'Соседи',
      reportingCurrency: 'USD',
      disabled: true,
      owners: 1,
      members: 1,
      createdAt: '2026-10-02T00:00:00.000Z',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/auth/me') return ok({ user: me });
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD', 'USD'], rates: [] });
      if (url === '/api/admin/ai') {
        return ok({
          enabled: false,
          model: 'gemini-3.8-flash',
          dailyLimit: 50,
          keyConfigured: false,
          keySource: 'none',
          keyHint: null,
          canStoreKey: true,
          usage: { today: 0, month: 0, errorsMonth: 0 },
          groups: [],
        });
      }
      if (url === '/api/admin/groups' && method === 'GET') return ok(groups);
      if (url === '/api/admin/groups' && method === 'POST')
        return ok({ id: 3, token: 'OWNER-NEW', expiresAt: EXPIRES }, 201);
      if (url.endsWith('/owner-invitations'))
        return ok({ token: 'OWNER-1', expiresAt: EXPIRES }, 201);
      if (url === '/api/admin/users/ghost/reset-password')
        return json({ success: false, error: { code: 'NOT_FOUND', message: 'нет' } }, 404);
      if (url.endsWith('/reset-password')) return ok({ token: 'RESET-9', expiresAt: EXPIRES }, 201);
      return ok({});
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAdmin() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="admin" element={<AdminPage />} />
          <Route path="/" element={<p>Главная</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const sent = (method: string, url: string) =>
  requests.find((r) => r.method === method && r.url === url)?.body;
const section = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('страница администрирования', () => {
  it('не администратору ничего не показывает', async () => {
    me = { ...ADMIN, isAdmin: false };
    renderAdmin();

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/admin/groups')).toBe(false);
  });

  it('перечисляет группы со статусом', async () => {
    renderAdmin();

    expect(await screen.findByText('Семья')).toBeInTheDocument();
    expect(screen.getByText('Соседи')).toBeInTheDocument();
    expect(screen.getByText('отключена')).toBeInTheDocument();
    expect(screen.getByText(/владельцев: 1 · участников: 3/)).toBeInTheDocument();
  });

  it('создаёт группу и показывает ссылку для владельца', async () => {
    const person = renderAdmin();
    await screen.findByText('Семья');

    await person.type(screen.getByLabelText('Название новой группы'), 'Друзья');
    await person.selectOptions(await screen.findByLabelText('Валюта отчётов'), 'USD');
    await person.click(screen.getByRole('button', { name: 'Создать группу' }));

    expect(await screen.findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/OWNER-NEW`,
    );
    expect(sent('POST', '/api/admin/groups')).toEqual({ name: 'Друзья', currency: 'USD' });
  });

  it('создаёт ссылку для владельца существующей группы', async () => {
    const person = renderAdmin();
    await screen.findByText('Семья');

    await person.click(screen.getByRole('button', { name: 'Ссылка для владельца: Семья' }));

    expect(await screen.findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/OWNER-1`,
    );
  });

  it('отключает группу с подтверждением и включает обратно', async () => {
    const person = renderAdmin();
    await screen.findByText('Семья');

    await person.click(screen.getByRole('button', { name: 'Отключить: Семья' }));
    expect(sent('PATCH', '/api/admin/groups/1')).toBeUndefined();
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Отключить' }),
    );
    expect(sent('PATCH', '/api/admin/groups/1')).toEqual({ disabled: true });

    await person.click(screen.getByRole('button', { name: 'Включить: Соседи' }));
    expect(sent('PATCH', '/api/admin/groups/2')).toEqual({ disabled: false });
  });
});

describe('сброс пароля', () => {
  it('создаёт ссылку по логину', async () => {
    const person = renderAdmin();
    await screen.findByText('Семья');
    const reset = within(section('Сброс пароля'));

    await person.type(reset.getByLabelText('Логин пользователя'), 'nastya');
    await person.click(reset.getByRole('button', { name: 'Создать ссылку для сброса пароля' }));

    expect(await reset.findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/RESET-9`,
    );
  });

  it('неизвестный логин: «Пользователь не найден»', async () => {
    const person = renderAdmin();
    await screen.findByText('Семья');
    const reset = within(section('Сброс пароля'));

    await person.type(reset.getByLabelText('Логин пользователя'), 'ghost');
    await person.click(reset.getByRole('button', { name: 'Создать ссылку для сброса пароля' }));

    expect(await reset.findByRole('alert')).toHaveTextContent('Пользователь не найден');
  });
});
