import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNotification } from '../src/features/notifications/api/notifications.api.ts';
import { NotificationBell } from '../src/features/notifications/components/NotificationBell.tsx';
import { dayGroupOf, groupByDay } from '../src/features/notifications/model/groups.ts';
import { previewOf } from '../src/features/notifications/components/NotificationDetails.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });
const failure = (status: number, code: string, message: string) =>
  json({ success: false, error: { code, message } }, status);

const at = (daysAgo: number, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  // Today at 12:00 may be in the future for the clock: the order of the groups is what counts
  return daysAgo === 0 ? new Date(Date.now() - 5 * 60_000).toISOString() : date.toISOString();
};

const note = (id: string, overrides: Partial<AppNotification> = {}): AppNotification => ({
  id,
  type: 'expense_imported',
  title: 'Расход добавлен',
  body: `150 AMD · Автобус ${id}`,
  link: '/analytics/operations?expense=e1&date=2026-10-17',
  data: { expenseId: 'e1', source: 'idbank', date: '2026-10-17' },
  createdAt: at(0),
  read: false,
  ...overrides,
});

const problem = (id: string, overrides: Partial<AppNotification> = {}) =>
  note(id, {
    type: 'import_problem',
    title: 'Не удалось добавить расход',
    body: 'Запрос не создал расход',
    link: '/group/integrations',
    data: {
      importId: `imp-${id}`,
      status: 'unrecognized',
      source: 'idbank',
      sourceLabel: 'IDBank',
      reason: 'Пустой текст уведомления (поле body)',
    },
    ...overrides,
  });

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'imp-p1',
  receivedAt: '2026-10-17T16:40:00.000Z',
  source: 'idbank',
  keyName: 'iPhone — IDBank',
  status: 'unrecognized',
  error: 'Пустой текст',
  rawPayload: { title: 'IDBank', body: '', source: 'push', extra: { a: 1 } },
  parsed: null,
  match: null,
  expenseId: null,
  retryable: true,
  ...overrides,
});

let feed: AppNotification[];
let unread: number;
let calls: { method: string; url: string; body?: Record<string, unknown> }[];
let entryResponse: Response | null;
let retryResponse: Response | null;

beforeEach(() => {
  feed = [];
  unread = 0;
  calls = [];
  entryResponse = null;
  retryResponse = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/notifications/unread-count') return ok({ unread });
      if (url === '/api/notifications/read') {
        feed = feed.map((item) =>
          !body?.ids || body.ids.includes(item.id) ? { ...item, read: true } : item,
        );
        unread = feed.filter((item) => !item.read).length;
        return ok({});
      }
      if (url.startsWith('/api/group/import-log/') && url.endsWith('/retry')) {
        return retryResponse ?? ok({ status: 'created', transactionId: 'e9' });
      }
      if (url.startsWith('/api/group/import-log/')) return entryResponse ?? ok(entry());
      if (url.startsWith('/api/notifications?')) return ok({ items: feed, unread });
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const Where = () => {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
};

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
const openPanel = async (person: ReturnType<typeof userEvent.setup>) => {
  await person.click(screen.getByRole('button', { name: /^Уведомления/ }));
  return within(await screen.findByRole('dialog', { name: 'Уведомления' }));
};

describe('группы по дням', () => {
  const now = new Date(2026, 9, 17, 15, 0);
  it('Сегодня, Вчера, Ранее по местному дню', () => {
    expect(dayGroupOf(new Date(2026, 9, 17, 1, 0).toISOString(), now)).toBe('Сегодня');
    expect(dayGroupOf(new Date(2026, 9, 16, 23, 0).toISOString(), now)).toBe('Вчера');
    expect(dayGroupOf(new Date(2026, 9, 15, 12, 0).toISOString(), now)).toBe('Ранее');
    const groups = groupByDay(
      [
        note('a', { createdAt: new Date(2026, 9, 17, 9, 0).toISOString() }),
        note('b', { createdAt: new Date(2026, 9, 10, 9, 0).toISOString() }),
      ],
      now,
    );
    expect(groups.map((group) => group.title)).toEqual(['Сегодня', 'Ранее']);
  });

  it('превью данных: title, body, source, остальное «...»; длинное режется', () => {
    expect(previewOf({ title: 'IDBank', body: '', source: 'push', extra: 1 })).toBe(
      'title: "IDBank"\nbody: ""\nsource: "push"\n...',
    );
    expect(previewOf({ body: 'x'.repeat(100) })).toContain('…');
  });
});

describe('панель уведомлений: шапка, фильтры, группы', () => {
  it('шапка: «Уведомления» и красное число, меню «⋯», закрыть; отдельной строки действий нет', async () => {
    feed = [note('a'), note('b')];
    unread = 2;
    const person = renderBell();
    const panel = await openPanel(person);

    expect(panel.getByRole('heading', { name: /^Уведомления/ })).toHaveTextContent('2');
    expect(panel.getByRole('button', { name: 'Меню уведомлений' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: 'Прочитать все' })).toBeNull();
    await person.click(panel.getByRole('button', { name: 'Меню уведомлений' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Прочитать все',
      'Скрыть все',
      'Настроить уведомления',
    ]);
  });

  it('число в шапке скрыто при нуле', async () => {
    feed = [note('a', { read: true })];
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    expect(screen.queryByTestId('panel-badge')).toBeNull();
  });

  it('фильтры со счётчиками: Все, Непрочитанные N, Ошибки N с красной точкой', async () => {
    feed = [note('a'), note('b', { read: true }), problem('p1')];
    unread = 2;
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    const filters = within(panel.getByRole('group', { name: 'Фильтр' }));
    expect(filters.getByRole('button', { name: /^Непрочитанные/ })).toHaveTextContent('2');
    expect(filters.getByRole('button', { name: /^Ошибки/ })).toHaveTextContent('1');
    expect(filters.getByLabelText('есть непрочитанные ошибки')).toBeInTheDocument();

    await person.click(filters.getByRole('button', { name: /^Непрочитанные/ }));
    expect(panel.getAllByRole('listitem')).toHaveLength(2);
    await person.click(filters.getByRole('button', { name: /^Ошибки/ }));
    expect(panel.getAllByRole('listitem')).toHaveLength(1);
    expect(panel.getByText('Не удалось добавить расход')).toBeInTheDocument();
    await person.click(filters.getByRole('button', { name: 'Все' }));
    expect(panel.getAllByRole('listitem')).toHaveLength(3);
  });

  it('пустые состояния фильтров с колокольчиком', async () => {
    feed = [note('a', { read: true })];
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findByText('Расход добавлен');

    await person.click(panel.getByRole('button', { name: /^Непрочитанные/ }));
    expect(panel.getByText('У вас нет непрочитанных уведомлений')).toBeInTheDocument();
    expect(panel.getByText('Мы сообщим вам, когда появятся новые уведомления')).toBeInTheDocument();
    await person.click(panel.getByRole('button', { name: /^Ошибки/ }));
    expect(panel.getByText('Ошибок нет')).toBeInTheDocument();
  });

  it('группы «Сегодня», «Вчера», «Ранее» с заголовками', async () => {
    feed = [note('a'), note('b', { createdAt: at(1) }), note('c', { createdAt: at(5) })];
    const person = renderBell();
    const panel = await openPanel(person);
    await panel.findAllByRole('listitem');

    expect(panel.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Сегодня',
      'Вчера',
      'Ранее',
    ]);
  });

  it('высота по содержимому: класс max-h, а не фиксированная высота', async () => {
    feed = [note('a')];
    const person = renderBell();
    await openPanel(person);

    const dialog = screen.getByRole('dialog', { name: 'Уведомления' });
    expect(dialog.className).toContain('max-h-[75dvh]');
    expect(dialog.className).toContain('sm:max-h-[70dvh]');
    expect(dialog.className).not.toMatch(/(^|\s)h-\[/);
  });
});

describe('карточки', () => {
  it('содержимое по типам: заголовок, строка «источник · время», текст, значок', async () => {
    feed = [
      note('a'),
      note('m', {
        type: 'member_joined',
        title: 'Новый участник',
        body: 'Настя присоединилась к группе «Семья»',
        link: '/group/members',
        data: { userId: 'u1', groupName: 'Семья' },
      }),
      note('s', {
        type: 'announcement',
        title: 'ВТОРОЕ ВНИМАНИЕ',
        body: 'Короткое сообщение',
        link: null,
        data: { broadcastId: 'b1', senderName: 'Миша', groupName: 'Семья' },
      }),
      problem('p1'),
      note('r', {
        type: 'receipt_parsed',
        title: 'Чек распознан',
        body: 'Магазин',
        link: '/analytics/operations',
        data: { expenseId: 'e2' },
      }),
    ];
    const person = renderBell();
    const panel = await openPanel(person);
    const rows = await panel.findAllByRole('listitem');
    const byTitle = (title: string) => rows.find((row) => row.textContent?.includes(title))!;

    expect(byTitle('Расход добавлен')).toHaveTextContent(/IDBank · /);
    expect(byTitle('Расход добавлен')).toHaveAttribute('data-type', 'expense_imported');
    expect(byTitle('Новый участник')).toHaveTextContent('Настя присоединилась к группе «Семья»');
    expect(byTitle('ВТОРОЕ ВНИМАНИЕ')).toHaveTextContent(/Миша · Семья · /);
    expect(byTitle('Не удалось добавить расход')).toHaveTextContent(
      'Пустой текст уведомления (поле body)',
    );
    expect(byTitle('Не удалось добавить расход')).toHaveTextContent(/IDBank · /);
    // A problem is a white card with a thin amber accent, not a yellow block
    expect(
      within(byTitle('Не удалось добавить расход'))
        .getByText('Не удалось добавить расход')
        .closest('div[style]')!.className,
    ).toContain('border-amber-400');
    expect(byTitle('Чек распознан')).toBeInTheDocument();
  });

  it('объявление раскрывается на месте: «Читать полностью», полный текст, снова свёрнуто', async () => {
    const long = 'ШОК контент. '.repeat(12);
    feed = [
      note('s', {
        type: 'announcement',
        title: 'ВНИМАНИЕ',
        body: long,
        link: null,
        data: { broadcastId: 'b1', senderName: 'Миша' },
      }),
    ];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    const card = (await panel.findByText('ВНИМАНИЕ')).closest('li')!;
    const main = within(card).getAllByRole('button')[0]!;

    expect(main).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).getByText('Читать полностью')).toBeInTheDocument();
    expect(within(card).getByText(long.trim()).className).toContain('line-clamp-2');
    await person.click(main);

    expect(main).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByText(long.trim()).className).not.toContain('line-clamp-2');
    expect(within(card).getByText('Свернуть')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/notifications/read')).toBe(true));
    await person.click(main);
    expect(main).toHaveAttribute('aria-expanded', 'false');
  });

  it('нажатие на «Расход добавлен» закрывает панель и открывает операцию по ссылке', async () => {
    feed = [note('a')];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);

    await person.click(await panel.findByText('Расход добавлен'));

    expect(screen.getByTestId('where')).toHaveTextContent(
      '/analytics/operations?expense=e1&date=2026-10-17',
    );
    expect(screen.queryByRole('dialog', { name: 'Уведомления' })).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/notifications/read')).toBe(true));
  });

  it('«Новый участник» ведёт на участников', async () => {
    feed = [
      note('m', {
        type: 'member_joined',
        title: 'Новый участник',
        body: 'Настя',
        link: '/group/members',
        data: { userId: 'u1' },
      }),
    ];
    const person = renderBell();
    const panel = await openPanel(person);

    await person.click(await panel.findByText('Новый участник'));

    expect(screen.getByTestId('where')).toHaveTextContent('/group/members');
  });
});

describe('экран подробностей ошибки импорта', () => {
  const openDetails = async () => {
    feed = [problem('p1')];
    unread = 1;
    const person = renderBell();
    const panel = await openPanel(person);
    await person.click(await panel.findByText('Не удалось добавить расход'));
    await screen.findByRole('button', { name: 'Назад' });
    return person;
  };

  it('нажатие открывает подробности: «←», заголовок «Уведомление», источник, причина, время, ключ; запрос записи журнала', async () => {
    await openDetails();

    expect(screen.getByRole('heading', { name: 'Уведомление' })).toBeInTheDocument();
    expect(screen.getByText('Источник').nextElementSibling).toHaveTextContent('IDBank');
    expect(screen.getByText('Причина').nextElementSibling).toHaveTextContent(
      'Пустой текст уведомления (поле body)',
    );
    expect(await screen.findByText('Ключ')).toBeInTheDocument();
    expect(screen.getByText('Ключ').nextElementSibling).toHaveTextContent('iPhone — IDBank');
    expect(screen.getByText('Время получения').nextElementSibling).toHaveTextContent(
      /17\.10\.2026/,
    );
    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/group/import-log/imp-p1')).toBe(
      true,
    );
  });

  it('полученные данные: превью и полный JSON текстом; копирование', async () => {
    const writeText = vi.fn(async () => undefined);
    const person = await openDetails();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const preview = await screen.findByLabelText('Полученные данные', { selector: 'pre' });
    expect(preview.textContent).toBe('title: "IDBank"\nbody: ""\nsource: "push"\n...');
    await person.click(screen.getByRole('button', { name: 'Копировать данные' }));
    expect(writeText).toHaveBeenCalledWith(preview.textContent);

    const json = screen.getByLabelText('JSON запроса');
    expect(json.tagName).toBe('PRE');
    expect(json.textContent).toContain('"extra": {');
    await person.click(screen.getByRole('button', { name: 'Копировать JSON' }));
    expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(entry().rawPayload, null, 2));
  });

  it('«Закрыть» возвращает к списку', async () => {
    const person = await openDetails();

    await person.click(screen.getAllByRole('button', { name: 'Закрыть' }).at(-1)!);

    expect(await screen.findByRole('group', { name: 'Фильтр' })).toBeInTheDocument();
  });

  it('«←» тоже возвращает к списку', async () => {
    const person = await openDetails();

    await person.click(screen.getByRole('button', { name: 'Назад' }));

    expect(await screen.findByRole('group', { name: 'Фильтр' })).toBeInTheDocument();
  });

  it('запись недоступна (404): понятное сообщение, кнопки повтора нет', async () => {
    entryResponse = failure(404, 'NOT_FOUND', 'Не найдено');
    await openDetails();

    expect(
      await screen.findByText('Запись больше недоступна: журнал хранится 30 дней'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить обработку' })).toBeNull();
  });

  it('retryable=false: кнопки «Повторить обработку» нет', async () => {
    entryResponse = ok(entry({ retryable: false }));
    await openDetails();

    await screen.findByText('Ключ');
    expect(screen.queryByRole('button', { name: 'Повторить обработку' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Закрыть' })).toHaveLength(2);
  });

  it('повтор удался: «Расход добавлен» и «Открыть операцию»; лента перечитывается', async () => {
    const person = await openDetails();
    const before = calls.filter((c) => c.url.startsWith('/api/notifications?')).length;

    await person.click(await screen.findByRole('button', { name: 'Повторить обработку' }));

    expect(await screen.findByText('Расход добавлен')).toBeInTheDocument();
    expect(
      calls.some((c) => c.method === 'POST' && c.url === '/api/group/import-log/imp-p1/retry'),
    ).toBe(true);
    await waitFor(() =>
      expect(calls.filter((c) => c.url.startsWith('/api/notifications?')).length).toBeGreaterThan(
        before,
      ),
    );
    await person.click(screen.getByRole('button', { name: 'Открыть операцию' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/analytics/operations?expense=e9');
  });

  it('повтор не удался: причина под кнопкой, кнопка остаётся', async () => {
    retryResponse = ok({ status: 'card_not_found', message: 'Нет карты с такими цифрами' });
    const person = await openDetails();

    await person.click(await screen.findByRole('button', { name: 'Повторить обработку' }));

    expect(await screen.findByText('Нет карты с такими цифрами')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить обработку' })).toBeInTheDocument();
  });

  it('409: сообщение сервера как есть', async () => {
    retryResponse = failure(409, 'KEY_GONE', 'Ключ, которым прислан запрос, уже удалён');
    const person = await openDetails();

    await person.click(await screen.findByRole('button', { name: 'Повторить обработку' }));

    expect(await screen.findByText('Ключ, которым прислан запрос, уже удалён')).toBeInTheDocument();
  });
});
