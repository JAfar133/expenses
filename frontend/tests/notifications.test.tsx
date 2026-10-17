import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../src/features/notifications/components/NotificationBell.tsx';
import { badgeText, relativeTime } from '../src/features/notifications/model/time.ts';
import type { AppNotification } from '../src/features/notifications/api/notifications.api.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });

const note = (n: number, overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: `n${n}`,
  type: 'expense_imported',
  title: 'Расход добавлен',
  body: `1 540 AMD · Магазин ${n}`,
  link: '/analytics/operations',
  data: null,
  createdAt: new Date(Date.now() - n * 60_000).toISOString(),
  read: false,
  ...overrides,
});

let feed: AppNotification[];
let unread: number;
let calls: { method: string; url: string; body?: { ids?: string[] } }[];
let feedFails: boolean;
let readFails: boolean;

beforeEach(() => {
  feed = [];
  unread = 0;
  feedFails = false;
  readFails = false;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as { ids?: string[] }) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/notifications/unread-count') return ok({ unread });
      if (url === '/api/notifications/read' && method === 'POST') {
        if (readFails)
          return json({ success: false, error: { code: 'X', message: 'Ошибка' } }, 500);
        // The server's state follows, so that the refetch after a change agrees with the screen
        feed = feed.map((item) =>
          !body?.ids || body.ids.includes(item.id) ? { ...item, read: true } : item,
        );
        unread = feed.filter((item) => !item.read).length;
        return ok({});
      }
      if (url.startsWith('/api/notifications?')) {
        if (feedFails)
          return json({ success: false, error: { code: 'X', message: 'Ошибка' } }, 500);
        const before = new URL(url, 'http://x').searchParams.get('before');
        const items = before ? feed.filter((item) => item.createdAt < before) : feed;
        return ok({ items: items.slice(0, 30), unread });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

function renderBell() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/']}>
        <NotificationBell />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const bell = () => screen.getByRole('button', { name: /^Уведомления/ });
const openPanel = async (person: ReturnType<typeof userEvent.setup>) => {
  await person.click(bell());
  return within(await screen.findByRole('dialog', { name: 'Уведомления' }));
};

describe('время и число на колокольчике', () => {
  const now = new Date(2026, 9, 17, 15, 0, 0);
  const at = (d: number, h: number, m: number, y = 2026) => new Date(y, 9, d, h, m).toISOString();

  it('относительное время: только что, минуты, сегодня, вчера, дата, дата с годом', () => {
    expect(relativeTime(new Date(now.getTime() - 20_000).toISOString(), now)).toBe('только что');
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe(
      '5 мин назад',
    );
    expect(relativeTime(at(17, 8, 5), now)).toBe('сегодня, 08:05');
    expect(relativeTime(at(16, 20, 41), now)).toBe('вчера, 20:41');
    expect(relativeTime(at(15, 20, 41), now)).toBe('15 окт., 20:41');
    expect(relativeTime(at(15, 20, 41, 2025), now)).toBe('15 окт. 2025 г., 20:41');
  });

  it('число: пусто при нуле, как есть до 99, «99+» выше', () => {
    expect([0, 1, 99, 100, 250].map(badgeText)).toEqual(['', '1', '99', '99+', '99+']);
  });
});

describe('колокольчик', () => {
  it('без непрочитанных: имя «Уведомления», бейджа нет, aria-expanded=false', async () => {
    renderBell();

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/notifications/unread-count')).toBe(true),
    );
    expect(bell()).toHaveAccessibleName('Уведомления');
    expect(screen.queryByTestId('bell-badge')).toBeNull();
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
  });

  it('с непрочитанными: число на бейдже и в имени кнопки; выше 99 — «99+»', async () => {
    unread = 7;
    renderBell();

    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 7' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('7');
  });

  it('больше 99: бейдж «99+»', async () => {
    unread = 150;
    renderBell();

    await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 150' });
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('99+');
  });

  it('пока панель закрыта, ленту не запрашивает', async () => {
    unread = 2;
    renderBell();

    await screen.findByTestId('bell-badge');
    expect(calls.some((c) => c.url.startsWith('/api/notifications?'))).toBe(false);
  });

  it('ошибка опроса молчит: бейджа нет, ошибок на экране нет', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      json({ success: false }, 500),
    );
    renderBell();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('bell-badge')).toBeNull();
  });
});

describe('опрос счётчика', () => {
  const polls = () => calls.filter((c) => c.url === '/api/notifications/unread-count').length;

  it('раз в минуту, пока вкладка видна; на скрытой вкладке не опрашивает', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBell();
    await waitFor(() => expect(polls()).toBe(1));

    await act(() => vi.advanceTimersByTimeAsync(61_000));
    await waitFor(() => expect(polls()).toBe(2));

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(() => vi.advanceTimersByTimeAsync(130_000));
    expect(polls()).toBe(2);
  });

  it('возврат на вкладку обновляет счётчик', async () => {
    renderBell();
    await waitFor(() => expect(polls()).toBe(1));
    unread = 4;

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });

    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 4' }),
    ).toBeInTheDocument();
  });
});

describe('панель', () => {
  it('открывается по нажатию, запрашивает ленту, закрывается по Escape и возвращает фокус на колокольчик', async () => {
    feed = [note(1)];
    unread = 1;
    const person = renderBell();

    const panel = await openPanel(person);
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    expect(await panel.findByText('Расход добавлен')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/notifications?limit=30')).toBe(true);

    await person.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Уведомления' })).toBeNull();
    expect(bell()).toHaveFocus();
  });

  it('нажатие вне панели закрывает её', async () => {
    feed = [note(1)];
    const person = renderBell();
    await openPanel(person);

    await person.click(document.body);

    expect(screen.queryByRole('dialog', { name: 'Уведомления' })).toBeNull();
  });

  it('строки: значок, заголовок, текст, время и точка у непрочитанного; прочитанное без точки', async () => {
    feed = [
      note(0, { createdAt: new Date(Date.now() - 20_000).toISOString() }),
      note(5, { read: true, body: 'Чек: Магазин 5' }),
    ];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);

    const rows = await panel.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Расход добавлен')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('1 540 AMD · Магазин 0')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('только что')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('img', { name: 'Не прочитано' })).toBeInTheDocument();
    expect(within(rows[1]!).getByText('5 мин назад')).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('img', { name: 'Не прочитано' })).toBeNull();
  });

  it('проблема импорта выделена как предупреждение', async () => {
    feed = [
      note(1, { type: 'import_problem', title: 'Не удалось добавить расход', link: '/group' }),
    ];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);

    const row = (await panel.findByText('Не удалось добавить расход')).closest('li')!;
    expect(row).toHaveAttribute('data-type', 'import_problem');
    expect(row.querySelector('button')!.className).toContain('bg-amber-50');
  });

  it('тап по строке: отмечает прочитанным (POST ids), переходит по ссылке и закрывает панель', async () => {
    feed = [note(1), note(2)];
    unread = 2;
    const person = renderBell();
    const panel = await openPanel(person);

    await person.click(await panel.findByText('1 540 AMD · Магазин 1'));

    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/notifications/read')?.body).toEqual({ ids: ['n1'] }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/analytics/operations');
    expect(screen.queryByRole('dialog', { name: 'Уведомления' })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 1' }),
    ).toBeInTheDocument();
  });

  it('тап по строке без ссылки только отмечает прочитанным и оставляет панель открытой', async () => {
    feed = [note(1, { link: null })];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);

    await person.click(await panel.findByText('Расход добавлен'));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/notifications/read')).toBe(true));
    expect(screen.getByRole('dialog', { name: 'Уведомления' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(panel.queryByRole('img', { name: 'Не прочитано' })).toBeNull());
  });

  it('«Прочитать все»: сразу всё прочитано и бейдж пропал; запрос без ids', async () => {
    feed = [note(1), note(2)];
    unread = 2;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    await person.click(panel.getByRole('button', { name: 'Прочитать все' }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/notifications/read')?.body).toEqual({}),
    );
    expect(panel.queryByRole('img', { name: 'Не прочитано' })).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('bell-badge')).toBeNull());
    expect(panel.getByRole('button', { name: 'Прочитать все' })).toBeDisabled();
  });

  it('ошибка при «Прочитать все»: всё возвращается как было', async () => {
    readFails = true;
    feed = [note(1)];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    await person.click(panel.getByRole('button', { name: 'Прочитать все' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/notifications/read')).toBe(true));
    expect(await panel.findByRole('img', { name: 'Не прочитано' })).toBeInTheDocument();
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('1');
  });

  it('«Прочитать все» недоступна, когда непрочитанных нет', async () => {
    feed = [note(1, { read: true })];
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    expect(panel.getByRole('button', { name: 'Прочитать все' })).toBeDisabled();
  });

  it('«Показать ещё» подгружает следующую страницу с before и дописывает её', async () => {
    feed = Array.from({ length: 35 }, (_, i) => note(i + 1, { body: `Покупка ${i + 1}` }));
    unread = 35;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Покупка 1');
    expect(panel.getAllByRole('listitem')).toHaveLength(30);

    await person.click(panel.getByRole('button', { name: 'Показать ещё' }));

    await waitFor(() => expect(panel.getAllByRole('listitem')).toHaveLength(35));
    expect(calls.some((c) => c.url.includes('before='))).toBe(true);
    expect(panel.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('пустая лента: подсказка', async () => {
    const person = renderBell();
    const panel = await openPanel(person);

    expect(
      await panel.findByText(
        'Пока уведомлений нет. Здесь появятся новые расходы из банка, ошибки импорта и распознанные чеки',
      ),
    ).toBeInTheDocument();
  });

  it('ошибка загрузки: «Не удалось загрузить» и «Повторить» перезапрашивает', async () => {
    feedFails = true;
    const person = renderBell();
    const panel = await openPanel(person);

    expect(await panel.findByText('Не удалось загрузить')).toBeInTheDocument();
    feedFails = false;
    feed = [note(1)];
    await person.click(panel.getByRole('button', { name: 'Повторить' }));

    expect(await panel.findByText('Расход добавлен')).toBeInTheDocument();
  });

  it('пока лента грузится, показан скелет', async () => {
    let release: (value: Response) => void = () => undefined;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url === '/api/notifications/unread-count') return ok({ unread: 0 });
      return new Promise<Response>((resolve) => (release = resolve));
    });
    const person = renderBell();
    const panel = await openPanel(person);

    expect(panel.getByRole('status', { name: 'Загрузка' })).toBeInTheDocument();
    release(ok({ items: [], unread: 0 }));
    await waitFor(() => expect(panel.queryByRole('status', { name: 'Загрузка' })).toBeNull());
  });
});

describe('значок на иконке и ссылка на настройки', () => {
  it('число непрочитанных уходит в setAppBadge, ноль сбрасывает значок; ошибки молчат', async () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true });
    Object.defineProperty(navigator, 'clearAppBadge', { value: clearAppBadge, configurable: true });
    unread = 5;
    renderBell();

    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(5));
    expect(clearAppBadge).not.toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).setAppBadge;
    delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
  });

  it('при нуле вызывается clearAppBadge', async () => {
    const clearAppBadge = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clearAppBadge', { value: clearAppBadge, configurable: true });
    unread = 0;
    renderBell();

    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
    delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
  });

  it('внизу панели ссылка «Настроить уведомления» ведёт в настройки', async () => {
    const person = renderBell();
    const panel = await openPanel(person);

    const link = await panel.findByRole('link', { name: 'Настроить уведомления' });
    expect(link).toHaveAttribute('href', '/settings#notifications');
    await person.click(link);

    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
    expect(screen.queryByRole('dialog', { name: 'Уведомления' })).toBeNull();
  });
});
