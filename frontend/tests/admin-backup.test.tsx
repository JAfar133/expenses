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

const shot = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const AT = shot('2026-10-12T03:00:00.000Z');
const INSTRUCTION = 'Проверьте на сервере: ./scripts/backup-db.sh · лог ~/backups/backup.log';

describe('раздел «Бэкап базы»', () => {
  it('раздел стоит первым на странице', async () => {
    await renderAdmin();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[1]).toBe('Бэкап базы');
  });

  it('ok: одна строка — дата, имя файла, размер, OneDrive; без инструкции и лишних строк', async () => {
    await renderAdmin();
    const box = within(section());

    expect(await box.findByText(AT)).toBeInTheDocument();
    expect(box.getByText('expenses-2026-10-12.dump')).toBeInTheDocument();
    expect(box.getByText('2,5 МБ')).toBeInTheDocument();
    expect(box.getByText('OneDrive')).toBeInTheDocument();
    expect(box.queryByText(INSTRUCTION)).toBeNull();
    expect(box.queryByRole('alert')).toBeNull();
    expect(box.queryByText(/Последний запуск/)).toBeNull();
    expect(box.queryByText(/назад/)).toBeNull();
  });

  it('OneDrive: не загрузилась — красная отметка; не используется — без неё', async () => {
    current = backup({
      lastSuccess: {
        at: '2026-10-12T03:00:00.000Z',
        file: 'a.dump',
        sizeBytes: 10,
        remote: 'failed',
      },
    });
    await renderAdmin();
    expect(await within(section()).findByText('OneDrive ✗')).toBeInTheDocument();
  });

  it('OneDrive не используется: части про него нет', async () => {
    current = backup({
      lastSuccess: { at: '2026-10-12T03:00:00.000Z', file: 'a.dump', sizeBytes: 10, remote: 'off' },
    });
    await renderAdmin();
    expect(await within(section()).findByText('10 Б')).toBeInTheDocument();
    expect(within(section()).queryByText('OneDrive')).toBeNull();
  });

  it('stale: «Нет свежей копии · последняя … (2 дн. назад)» и строка-инструкция', async () => {
    current = backup({ state: 'stale', ageHours: 60 });
    await renderAdmin();
    const box = within(section());

    expect(
      await box.findByText(`Нет свежей копии · последняя ${AT} (2 дн. назад)`),
    ).toBeInTheDocument();
    expect(box.getByText(INSTRUCTION)).toBeInTheDocument();
    expect(box.queryByRole('alert')).toBeNull();
  });

  it('stale без единой копии: «Копий нет»', async () => {
    current = backup({ state: 'stale', lastSuccess: null, ageHours: null });
    await renderAdmin();
    const box = within(section());

    expect(await box.findByText('Копий нет')).toBeInTheDocument();
    expect(box.getByText(INSTRUCTION)).toBeInTheDocument();
  });

  it.each([
    ['dump_failed', 'дамп не снят'],
    ['verify_failed', 'дамп не прошёл проверку'],
    ['upload_failed', 'не загрузилась в OneDrive'],
    ['unexpected', 'непредвиденная ошибка'],
  ])('failed, ошибка %s: «%s», с последней копией и инструкцией', async (error, text) => {
    current = backup({
      state: 'failed',
      lastRun: { at: '2026-10-12T03:00:00.000Z', ok: false, error },
    });
    await renderAdmin();
    const box = within(section());

    expect(
      await box.findByText(`Ошибка запуска: ${text} · последняя копия ${AT}`),
    ).toBeInTheDocument();
    expect(box.getByText(INSTRUCTION)).toBeInTheDocument();
  });

  it('нет данных: серый «Нет данных» без инструкции', async () => {
    current = backup({ state: 'unknown', lastSuccess: null, lastRun: null, ageHours: null });
    await renderAdmin();
    const box = within(section());

    expect(await box.findByText('Нет данных')).toBeInTheDocument();
    expect(box.queryByText(INSTRUCTION)).toBeNull();
  });

  it('не настроено на сервере: «Не настроено»', async () => {
    current = backup({
      configured: false,
      state: 'unknown',
      lastSuccess: null,
      lastRun: null,
      ageHours: null,
    });
    await renderAdmin();
    expect(await within(section()).findByText('Не настроено')).toBeInTheDocument();
  });

  it('«Обновить» запрашивает состояние заново', async () => {
    const person = await renderAdmin();
    await within(section()).findByText(AT);
    const before = requests.filter((r) => r === '/api/admin/backup').length;

    current = backup({ state: 'stale', ageHours: 60 });
    await person.click(within(section()).getByRole('button', { name: 'Обновить' }));

    expect(await within(section()).findByText(/Нет свежей копии/)).toBeInTheDocument();
    expect(requests.filter((r) => r === '/api/admin/backup').length).toBe(before + 1);
  });

  it('подсказка короткая и называет предел в часах', async () => {
    const person = await renderAdmin();
    await within(section()).findByText(AT);

    await person.click(within(section()).getByRole('button', { name: 'Подсказка' }));

    expect(within(section()).getByText(/дольше 26 ч\)/)).toBeInTheDocument();
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
