import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from '../src/features/admin/pages/AdminPage.tsx';
import { formatAge, formatSize } from '../src/features/admin/model/backup.ts';
import { UserBar } from '../src/features/auth/components/UserBar.tsx';
import type { AuthUser } from '../src/features/auth/api/auth.api.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });

const ADMIN: AuthUser = {
  username: 'root',
  displayName: 'Админ',
  card: 'Админ',
  canEdit: false,
  timezone: 'Asia/Yerevan',
  role: null,
  isAdmin: true,
};
const MEMBER: AuthUser = {
  ...ADMIN,
  username: 'anna',
  displayName: 'Анна',
  isAdmin: false,
  role: 'member',
};

const backup = (overrides: Record<string, unknown> = {}) => ({
  configured: true,
  state: 'ok',
  lastSuccess: {
    at: '2026-10-12T03:00:00.000Z',
    file: 'expenses-2026-10-12.dump',
    sizeBytes: 2_621_440,
    remote: 'ok',
  },
  lastRun: { at: '2026-10-12T03:00:00.000Z', ok: true, error: '' },
  ageHours: 9.4,
  maxAgeHours: 26,
  ...overrides,
});

let current: Record<string, unknown>;
let requests: string[];

beforeEach(() => {
  current = backup();
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/admin/backup') return ok(current);
      if (url === '/api/admin/groups') return ok([]);
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD'], rates: [] });
      if (url === '/api/admin/sync') return ok({ configured: true, enabled: true });
      if (url === '/api/sync/status') return ok({ enabled: false });
      if (url === '/api/auth/me') return ok({ user: ADMIN });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function renderAdmin() {
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="admin" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Бэкап базы' });
  return userEvent.setup();
}

const section = () => screen.getByRole('heading', { name: 'Бэкап базы' }).closest('section')!;

describe('форматирование', () => {
  it('размер: байты, КБ, МБ', () => {
    expect(formatSize(512)).toBe('512 Б');
    expect(formatSize(49_459)).toBe('48,3 КБ');
    expect(formatSize(2_621_440)).toBe('2,5 МБ');
  });

  it('возраст: меньше часа, часы, дни', () => {
    expect(formatAge(0.4)).toBe('меньше часа назад');
    expect(formatAge(9.4)).toBe('9 ч назад');
    expect(formatAge(72)).toBe('3 дн. назад');
    expect(formatAge(null)).toBe('');
  });
});

describe('раздел «Бэкап базы»', () => {
  it('раздел стоит первым на странице', async () => {
    await renderAdmin();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[1]).toBe('Бэкап базы');
  });

  it('всё в порядке: статус, последняя копия с возрастом, файл, размер, OneDrive, запуск', async () => {
    await renderAdmin();
    const box = within(section());

    expect(await box.findByText('Всё в порядке')).toBeInTheDocument();
    expect(box.getByText(/Последняя копия: .*\(9 ч назад\)/)).toBeInTheDocument();
    expect(box.getByText('expenses-2026-10-12.dump · 2,5 МБ')).toBeInTheDocument();
    expect(box.getByText('Копия в OneDrive: есть')).toBeInTheDocument();
    expect(box.getByText(/Последний запуск: .* — успешно/)).toBeInTheDocument();
    expect(box.queryByRole('alert')).toBeNull();
  });

  it('давно не было копии: красная плашка с инструкцией', async () => {
    current = backup({ state: 'stale', ageHours: 60 });
    await renderAdmin();
    const box = within(section());

    expect(await box.findByText('Давно не было копии')).toBeInTheDocument();
    expect(box.getByRole('alert')).toHaveTextContent(
      'Проверьте на сервере: ./scripts/backup-db.sh и лог ~/backups/backup.log',
    );
    expect(box.getByText(/\(2 дн\. назад\)/)).toBeInTheDocument();
  });

  it.each([
    ['dump_failed', 'не удалось снять дамп базы'],
    ['verify_failed', 'дамп не прошёл проверку'],
    ['upload_failed', 'копия не загрузилась в OneDrive (локальная копия есть)'],
    ['unexpected', 'непредвиденная ошибка'],
  ])('последний запуск с ошибкой %s: «%s»', async (error, text) => {
    current = backup({
      state: 'failed',
      lastRun: { at: '2026-10-12T03:00:00.000Z', ok: false, error },
    });
    await renderAdmin();
    const box = within(section());

    expect(await box.findByText('Последний запуск закончился ошибкой')).toBeInTheDocument();
    expect(
      box.getByText(new RegExp(`ошибка: ${text.replace(/[()]/g, '\\$&')}`)),
    ).toBeInTheDocument();
    expect(box.getByRole('alert')).toBeInTheDocument();
  });

  it('копия в OneDrive: не загрузилась и не используется', async () => {
    current = backup({
      lastSuccess: {
        at: '2026-10-12T03:00:00.000Z',
        file: 'a.dump',
        sizeBytes: 10,
        remote: 'failed',
      },
    });
    await renderAdmin();
    expect(
      await within(section()).findByText('Копия в OneDrive: не загрузилась'),
    ).toBeInTheDocument();
  });

  it('нет данных: серый статус без плашки; не настроено: свой текст', async () => {
    current = backup({ state: 'unknown', lastSuccess: null, lastRun: null, ageHours: null });
    await renderAdmin();
    expect(await within(section()).findByText('Нет данных о бэкапах')).toBeInTheDocument();
    expect(within(section()).queryByRole('alert')).toBeNull();
  });

  it('не настроено на сервере', async () => {
    current = backup({
      configured: false,
      state: 'unknown',
      lastSuccess: null,
      lastRun: null,
      ageHours: null,
    });
    await renderAdmin();
    expect(await within(section()).findByText('Не настроено на сервере')).toBeInTheDocument();
  });

  it('«Обновить» запрашивает состояние заново', async () => {
    const person = await renderAdmin();
    await within(section()).findByText('Всё в порядке');
    const before = requests.filter((r) => r === '/api/admin/backup').length;

    current = backup({ state: 'stale' });
    await person.click(within(section()).getByRole('button', { name: 'Обновить' }));

    expect(await within(section()).findByText('Давно не было копии')).toBeInTheDocument();
    expect(requests.filter((r) => r === '/api/admin/backup').length).toBe(before + 1);
  });

  it('подсказка называет предел в часах', async () => {
    const person = await renderAdmin();
    await within(section()).findByText('Всё в порядке');

    await person.click(within(section()).getByRole('button', { name: 'Подсказка' }));

    expect(within(section()).getByText(/дольше 26 часов/)).toBeInTheDocument();
  });
});

describe('красная точка у ссылки «Админ»', () => {
  const renderBar = (user: AuthUser) =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <UserBar user={user} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it.each(['stale', 'failed'])(
    'у администратора при состоянии %s есть точка с текстом',
    async (state) => {
      current = backup({ state });
      renderBar(ADMIN);

      expect(await screen.findByText('есть проблема с бэкапом')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Админ/ })).toHaveTextContent(
        'есть проблема с бэкапом',
      );
    },
  );

  it.each(['ok', 'unknown'])('при состоянии %s точки нет', async (state) => {
    current = backup({ state });
    renderBar(ADMIN);

    await waitFor(() => expect(requests).toContain('/api/admin/backup'));
    expect(screen.queryByText('есть проблема с бэкапом')).toBeNull();
  });

  it('не администратору точку не показывают и эндпоинт не запрашивают', async () => {
    current = backup({ state: 'failed' });
    renderBar(MEMBER);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).not.toContain('/api/admin/backup');
    expect(screen.queryByText('есть проблема с бэкапом')).toBeNull();
    expect(screen.queryByRole('link', { name: /Админ/ })).toBeNull();
  });
});
