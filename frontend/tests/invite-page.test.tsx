import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvitePage from '../src/features/group/pages/InvitePage.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);
const failure = (code: string, message: string, status: number) =>
  json({ success: false, error: { code, message } }, status);

const ME = {
  username: 'anna',
  displayName: 'Анна',
  card: 'Анна',
  canEdit: false,
  timezone: 'Asia/Yerevan',
  role: 'member',
  isAdmin: false,
};

let preview: () => Response;
let accept: (body: Record<string, unknown>) => Response;
let requests: { method: string; url: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  requests = [];
  preview = () => ok({ kind: 'join', groupName: 'Семья', role: 'member', username: null });
  accept = () => ok({ username: 'anna' }, 201);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/invitations/tok123') return preview();
      if (url === '/api/invitations/tok123/accept') return accept(body);
      if (url === '/api/auth/me') return ok({ user: ME });
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderInvite() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/invite/tok123']}>
        <Routes>
          <Route path="invite/:token" element={<InvitePage />} />
          <Route path="/" element={<p>Главная</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const fillPasswords = async (person: ReturnType<typeof userEvent.setup>, a: string, b = a) => {
  await person.type(screen.getByLabelText('Пароль'), a);
  await person.type(screen.getByLabelText('Повторите пароль'), b);
};

describe('страница приглашения', () => {
  it('приглашение в группу: отправляет данные и открывает приложение', async () => {
    const person = renderInvite();
    expect(
      await screen.findByRole('heading', { name: 'Приглашение в группу «Семья»' }),
    ).toBeInTheDocument();

    await person.type(screen.getByLabelText('Логин'), 'anna');
    await person.type(screen.getByLabelText('Имя'), 'Анна');
    await fillPasswords(person, 'secret-pass-1');
    await person.click(screen.getByRole('button', { name: 'Присоединиться' }));

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.find((r) => r.url === '/api/invitations/tok123/accept')?.body).toEqual({
      username: 'anna',
      displayName: 'Анна',
      password: 'secret-pass-1',
    });
  });

  it('сброс пароля: только пароль и повтор', async () => {
    preview = () => ok({ kind: 'reset', groupName: null, role: null, username: 'anna' });
    const person = renderInvite();
    expect(
      await screen.findByRole('heading', { name: 'Новый пароль для anna' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Логин')).toBeNull();

    await fillPasswords(person, 'new-secret-2');
    await person.click(screen.getByRole('button', { name: 'Сохранить пароль' }));

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.find((r) => r.url.endsWith('/accept'))?.body).toEqual({
      password: 'new-secret-2',
    });
  });

  it('недействительная ссылка: спокойное сообщение и никакой формы', async () => {
    preview = () => failure('INVITATION_INVALID', 'Приглашение недействительно', 404);
    renderInvite();

    expect(
      await screen.findByText('Приглашение недействительно или истекло. Попросите новую ссылку.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).toBeNull();
  });

  it('разные пароли не отправляются', async () => {
    const person = renderInvite();
    await screen.findByLabelText('Логин');

    await person.type(screen.getByLabelText('Логин'), 'anna');
    await fillPasswords(person, 'secret-pass-1', 'другой-пароль');
    await person.click(screen.getByRole('button', { name: 'Присоединиться' }));

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith('/accept'))).toBe(false);
  });

  it('ошибка сервера показывается, остаёмся на форме', async () => {
    accept = () => failure('USERNAME_TAKEN', 'Такой логин уже занят', 409);
    const person = renderInvite();
    await screen.findByLabelText('Логин');

    await person.type(screen.getByLabelText('Логин'), 'anna');
    await fillPasswords(person, 'secret-pass-1');
    await person.click(screen.getByRole('button', { name: 'Присоединиться' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Такой логин уже занят');
    await waitFor(() => expect(screen.queryByText('Главная')).toBeNull());
  });
});
