import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
let dismissFails: boolean;

beforeEach(() => {
  feed = [];
  unread = 0;
  feedFails = false;
  readFails = false;
  dismissFails = false;
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
      if (url === '/api/notifications/dismiss' && method === 'POST') {
        if (dismissFails)
          return json({ success: false, error: { code: 'X', message: 'Ошибка' } }, 500);
        const ids = body?.ids ?? feed.map((item) => item.id);
        feed = feed.filter((item) => !ids.includes(item.id));
        unread = feed.filter((item) => !item.read).length;
        return ok({ ids });
      }
      if (url === '/api/notifications/restore' && method === 'POST') return ok({});
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

  it('раз в 30 секунд, пока вкладка видна; на скрытой вкладке не опрашивает', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBell();
    await waitFor(() => expect(polls()).toBe(1));

    await act(() => vi.advanceTimersByTimeAsync(31_000));
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

  it('сообщение владельца: значок, «Отправитель: <имя>» под заголовком; без имени строки нет', async () => {
    feed = [
      note(1, {
        type: 'announcement',
        title: 'Сообщение · Миша',
        body: 'Завтра обновление',
        link: null,
        data: { senderName: 'Миша' },
      }),
      note(2, { type: 'announcement', title: 'Без имени', body: 'Текст', link: null, data: null }),
    ];
    unread = 2;
    const person = renderBell();
    const panel = await openPanel(person);

    const rows = await panel.findAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('data-type', 'announcement');
    expect(within(rows[0]!).getByText('Отправитель: Миша')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Завтра обновление')).toBeInTheDocument();
    expect(within(rows[1]!).queryByText(/^От /)).toBeNull();
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
    expect(row.querySelector('div[style]')!.className).toContain('bg-amber-50');
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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((event: Event) => void)[]>();
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }
  removeEventListener(type: string, handler: (event: Event) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== handler),
    );
  }
  emit(type: string, data: string) {
    for (const handler of this.listeners.get(type) ?? []) handler({ data } as unknown as Event);
  }
}

describe('живая линия (SSE)', () => {
  const polls = () => calls.filter((c) => c.url === '/api/notifications/unread-count').length;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('подключается один раз к /api/notifications/stream', async () => {
    renderBell();

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]!.url).toBe('/api/notifications/stream');
  });

  it('событие unread меняет бейдж сразу, без опроса', async () => {
    renderBell();
    await waitFor(() => expect(polls()).toBe(1));
    const stream = FakeEventSource.instances[0]!;

    await act(async () => stream.emit('unread', JSON.stringify({ unread: 4 })));

    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 4' }),
    ).toBeInTheDocument();
    expect(polls()).toBe(1);
    await act(async () => stream.emit('unread', JSON.stringify({ unread: 0 })));
    await waitFor(() => expect(screen.queryByTestId('bell-badge')).toBeNull());
  });

  it('сломанное сообщение пропускается', async () => {
    unread = 2;
    renderBell();
    await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 2' });

    await act(async () => {
      FakeEventSource.instances[0]!.emit('unread', 'не json');
      FakeEventSource.instances[0]!.emit('unread', JSON.stringify({ unread: 'много' }));
    });

    expect(
      screen.getByRole('button', { name: 'Уведомления, непрочитанных: 2' }),
    ).toBeInTheDocument();
  });

  it('при открытой панели новое событие обновляет ленту', async () => {
    feed = [note(1)];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');
    const feedRequests = () => calls.filter((c) => c.url.startsWith('/api/notifications?')).length;
    const before = feedRequests();
    feed = [note(2), note(1)];
    unread = 2;

    await act(async () =>
      FakeEventSource.instances[0]!.emit('unread', JSON.stringify({ unread: 2 })),
    );

    await waitFor(() => expect(feedRequests()).toBeGreaterThan(before));
    expect(await panel.findByText('1 540 AMD · Магазин 2')).toBeInTheDocument();
  });

  it('закрытая панель: ленту не запрашивает', async () => {
    renderBell();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () =>
      FakeEventSource.instances[0]!.emit('unread', JSON.stringify({ unread: 3 })),
    );

    expect(calls.some((c) => c.url.startsWith('/api/notifications?'))).toBe(false);
  });

  it('закрывается при размонтировании; без EventSource ничего не ломается', async () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    unmount();
    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalled();

    vi.stubGlobal('EventSource', undefined);
    unread = 1;
    renderBell();
    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 1' }),
    ).toBeInTheDocument();
  });

  it('число на иконке приложения следует за числом из потока', async () => {
    const setAppBadge = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true });
    renderBell();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () =>
      FakeEventSource.instances[0]!.emit('unread', JSON.stringify({ unread: 6 })),
    );

    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(6));
    delete (navigator as unknown as Record<string, unknown>).setAppBadge;
  });

  it('опрос остаётся запасным: раз в 30 секунд', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBell();
    await waitFor(() => expect(polls()).toBe(1));

    await act(() => vi.advanceTimersByTimeAsync(31_000));

    await waitFor(() => expect(polls()).toBe(2));
  });
});

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed = new Set<Element>();
  disconnect = vi.fn(() => this.observed.clear());
  constructor(
    public callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
    public options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  /** Reports how much of a row is visible. */
  see(id: string, ratio: number) {
    const target = [...this.observed].find((element) => element.getAttribute('data-id') === id);
    if (!target) throw new Error(`row ${id} is not observed`);
    this.callback([{ target, intersectionRatio: ratio, isIntersecting: ratio > 0 }]);
  }
}
const lastObserver = () => FakeIntersectionObserver.instances.at(-1)!;
const readCalls = () => calls.filter((c) => c.url === '/api/notifications/read');

describe('автопрочтение', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('строки, которые видно на 60% и больше около 0,8 с, помечаются одним запросом после паузы', async () => {
    feed = [note(1), note(2), note(3)];
    unread = 3;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    await act(async () => {
      lastObserver().see('n1', 0.8);
      lastObserver().see('n2', 1);
      lastObserver().see('n3', 0.3);
    });
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(readCalls()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(readCalls()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(600));

    await waitFor(() => expect(readCalls()).toHaveLength(1));
    expect(readCalls()[0]!.body).toEqual({ ids: ['n1', 'n2'] });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Уведомления, непрочитанных: 1' }),
      ).toBeInTheDocument(),
    );
  });

  it('строка, которая ушла из видимости раньше 0,8 с, не помечается', async () => {
    feed = [note(1)];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    await act(async () => lastObserver().see('n1', 1));
    await act(() => vi.advanceTimersByTimeAsync(400));
    await act(async () => lastObserver().see('n1', 0.2));
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(readCalls()).toHaveLength(0);
  });

  it('вкладка скрыта: ничего не помечается', async () => {
    feed = [note(1)];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    await act(async () => lastObserver().see('n1', 1));
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(readCalls()).toHaveLength(0);
  });

  it('панель закрыта: наблюдателя нет и ничего не помечается', async () => {
    feed = [note(1)];
    unread = 1;
    renderBell();

    await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 1' });
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(readCalls()).toHaveLength(0);
  });

  it('новая строка из потока при открытой панели тоже наблюдается и помечается', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    FakeEventSource.instances = [];
    feed = [note(1, { read: true })];
    unread = 0;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');
    feed = [note(2), note(1, { read: true })];
    unread = 1;

    await act(async () =>
      FakeEventSource.instances[0]!.emit('unread', JSON.stringify({ unread: 1 })),
    );
    await panel.findByText('1 540 AMD · Магазин 2');
    await waitFor(() =>
      expect([...lastObserver().observed].some((el) => el.getAttribute('data-id') === 'n2')).toBe(
        true,
      ),
    );
    await act(async () => lastObserver().see('n2', 1));
    await act(() => vi.advanceTimersByTimeAsync(1400));

    await waitFor(() => expect(readCalls()[0]?.body).toEqual({ ids: ['n2'] }));
  });

  it('без IntersectionObserver загруженные непрочитанные помечаются через 1,5 с', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    feed = [note(1), note(2)];
    unread = 2;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(readCalls()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(700));

    await waitFor(() => expect(readCalls()[0]?.body).toEqual({ ids: ['n1', 'n2'] }));
  });

  it('точка непрочитанного гаснет (прозрачность), когда строка стала прочитанной', async () => {
    feed = [note(1)];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    await act(async () => lastObserver().see('n1', 1));
    await act(() => vi.advanceTimersByTimeAsync(1400));

    await waitFor(() => expect(panel.queryByRole('img', { name: 'Не прочитано' })).toBeNull());
    expect(screen.getByRole('listitem').querySelector('.opacity-0')).not.toBeNull();
  });
});

describe('скрытие уведомлений', () => {
  const rowOf = (text: string) => screen.getByText(text).closest('li')!;
  const front = (row: HTMLElement) => row.querySelector<HTMLElement>('div[style*="touch-action"]')!;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 300,
    });
    feed = [note(1), note(2), note(3)];
    unread = 3;
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  });

  const dismissCalls = () => calls.filter((c) => c.url === '/api/notifications/dismiss');

  it('свайп влево дальше 40% ширины: строка уходит, уходит запрос с её id, число падает, тост «Скрыто: 1»', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');
    const target = front(rowOf('1 540 AMD · Магазин 1'));

    fireEvent.pointerDown(target, { clientX: 300, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 250, clientY: 22, pointerId: 1 });
    expect(target.style.transform).toBe('translateX(-50px)');
    expect(screen.getByText('Скрыть', { selector: 'div' })).toBeInTheDocument();
    fireEvent.pointerMove(target, { clientX: 140, clientY: 22, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 140, clientY: 22, pointerId: 1 });

    await waitFor(() => expect(panel.queryByText('1 540 AMD · Магазин 1')).toBeNull());
    expect(dismissCalls()[0]!.body).toEqual({ ids: ['n1'] });
    expect(await screen.findByText('Скрыто: 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуть' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 2' }),
    ).toBeInTheDocument();
  });

  it('быстрый короткий взмах тоже скрывает (флик)', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');
    const target = front(rowOf('1 540 AMD · Магазин 1'));

    fireEvent.pointerDown(target, { clientX: 300, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 240, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 240, clientY: 20, pointerId: 1 });

    await waitFor(() => expect(dismissCalls()).toHaveLength(1));
  });

  it('короткий свайп: строка возвращается на место, ничего не скрыто', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');
    const target = front(rowOf('1 540 AMD · Магазин 1'));

    fireEvent.pointerDown(target, { clientX: 300, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 280, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 280, clientY: 20, pointerId: 1 });

    expect(target.style.transform).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(dismissCalls()).toHaveLength(0);
    expect(panel.getByText('1 540 AMD · Магазин 1')).toBeInTheDocument();
  });

  it('вертикальное движение не начинает свайп', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');
    const target = front(rowOf('1 540 AMD · Магазин 1'));

    fireEvent.pointerDown(target, { clientX: 300, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 290, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 100, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 100, clientY: 90, pointerId: 1 });

    expect(target.style.transform).toBe('');
    expect(dismissCalls()).toHaveLength(0);
  });

  it('кнопка «×» (aria-label «Скрыть уведомление») скрывает строку', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 2');

    await person.click(
      within(rowOf('1 540 AMD · Магазин 2')).getByRole('button', { name: 'Скрыть уведомление' }),
    );

    await waitFor(() => expect(dismissCalls()[0]?.body).toEqual({ ids: ['n2'] }));
    await waitFor(() => expect(panel.queryByText('1 540 AMD · Магазин 2')).toBeNull());
  });

  it('клавиша Delete на строке скрывает её', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 3');
    const main = within(rowOf('1 540 AMD · Магазин 3')).getAllByRole('button')[0]!;
    main.focus();

    await person.keyboard('{Delete}');

    await waitFor(() => expect(dismissCalls()[0]?.body).toEqual({ ids: ['n3'] }));
  });

  it('уважает prefers-reduced-motion: строка пропадает сразу, без анимации', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('1 540 AMD · Магазин 1');

    await person.click(
      within(rowOf('1 540 AMD · Магазин 1')).getByRole('button', { name: 'Скрыть уведомление' }),
    );

    expect(panel.queryByText('1 540 AMD · Магазин 1')).toBeNull();
  });

  it('«Скрыть все»: запрос без ids, пустое состояние, тост с числом, число на колокольчике 0', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    await person.click(panel.getByRole('button', { name: 'Скрыть все' }));

    await waitFor(() => expect(dismissCalls()[0]?.body).toEqual({}));
    expect(
      await panel.findByText(
        'Пока уведомлений нет. Здесь появятся новые расходы из банка, ошибки импорта и распознанные чеки',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Скрыто: 3')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('bell-badge')).toBeNull());
    expect(panel.getByRole('button', { name: 'Скрыть все' })).toBeDisabled();
  });

  it('«Вернуть» шлёт restore с id и перечитывает ленту', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');
    await person.click(panel.getByRole('button', { name: 'Скрыть все' }));
    const undo = await screen.findByRole('button', { name: 'Вернуть' });
    const before = calls.filter((c) => c.url.startsWith('/api/notifications?')).length;
    feed = [note(1), note(2), note(3)];
    unread = 3;

    await person.click(undo);

    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/notifications/restore')?.body).toEqual({
        ids: ['n1', 'n2', 'n3'],
      }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.url.startsWith('/api/notifications?')).length).toBeGreaterThan(
        before,
      ),
    );
    expect(await panel.findByText('1 540 AMD · Магазин 1')).toBeInTheDocument();
    expect(screen.queryByText('Скрыто: 3')).toBeNull();
  });

  it('второе скрытие заменяет тост первого', async () => {
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    await person.click(
      within(rowOf('1 540 AMD · Магазин 1')).getByRole('button', { name: 'Скрыть уведомление' }),
    );
    await screen.findByText('Скрыто: 1');
    await person.click(
      within(rowOf('1 540 AMD · Магазин 2')).getByRole('button', { name: 'Скрыть уведомление' }),
    );

    await waitFor(() => expect(screen.getAllByText(/^Скрыто: /)).toHaveLength(1));
  });

  it('ошибка скрытия: строки возвращаются, число как было, сообщение об ошибке', async () => {
    dismissFails = true;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    await person.click(panel.getByRole('button', { name: 'Скрыть все' }));

    expect(await panel.findByText('Не удалось скрыть уведомление')).toBeInTheDocument();
    expect(await panel.findByText('1 540 AMD · Магазин 1')).toBeInTheDocument();
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('3');
    expect(screen.queryByText(/^Скрыто: /)).toBeNull();
  });
});
