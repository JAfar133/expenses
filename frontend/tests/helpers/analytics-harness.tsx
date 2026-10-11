import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import AnalyticsRoutes from '../../src/features/analytics/pages/AnalyticsRoutes.tsx';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const ok = (data: unknown) => json({ success: true, data });

export const stats = (overrides: Record<string, number> = {}) => ({
  total: 2100,
  count: 5,
  average: 420,
  median: 400,
  max: 700,
  activeDays: 3,
  firstDate: '2026-10-01',
  lastDate: '2026-10-10',
  days: 15,
  perDay: 140,
  ...overrides,
});

export const summary = {
  current: stats(),
  previous: stats({ total: 1000, count: 4, perDay: 66.67 }),
};

export const daily = [
  { period: '2026-10-01', total: 800, count: 2 },
  { period: '2026-10-02', total: 0, count: 0 },
  { period: '2026-10-10', total: 1300, count: 3 },
];

export const categories = [
  { key: 'кафе', total: 1500, count: 3, average: 500 },
  { key: 'продукты', total: 600, count: 2, average: 300 },
];

/** Наименования по категориям: ответ разбивки `by=name` при фильтре по одной категории. */
export const namesByCategory: Record<string, unknown[]> = {
  кафе: [
    { key: 'Латте', total: 900, count: 2, average: 450 },
    { key: 'Эспрессо', total: 600, count: 1, average: 600 },
  ],
  продукты: [{ key: 'Хлеб', total: 600, count: 2, average: 300 }],
};

type Handler = (url: URL) => Response | Promise<Response>;

/** Ответы поддельного сервера и журнал запросов; в каждом тесте создаются заново. */
export const harness: {
  handlers: Record<string, Handler>;
  requests: string[];
  /** Тела запросов в том же порядке, что и `requests` */
  bodies: unknown[];
} = {
  handlers: {},
  requests: [],
  bodies: [],
};

/** Общая подготовка тестов страницы анализа: «сегодня» 15 октября 2026, поддельный сервер, чистое хранилище. */
export function setupAnalyticsHarness() {
  beforeEach(() => {
    // Фиксируем только дату: от неё зависит текущий месяц, а таймеры нужны настоящие (задержка поиска)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
    localStorage.clear();

    harness.requests = [];
    harness.bodies = [];
    harness.handlers = {
      '/api/analytics/summary': () => ok(summary),
      '/api/analytics/timeseries': () => ok(daily),
      '/api/analytics/breakdown': (url) => {
        const by = url.searchParams.get('by');
        if (by === 'card') {
          return ok([
            { key: 'Миша', total: 1200, count: 3, average: 400 },
            { key: 'Настя', total: 900, count: 2, average: 450 },
          ]);
        }
        if (by === 'name')
          return ok(namesByCategory[url.searchParams.get('categories') ?? ''] ?? []);
        return ok(categories);
      },
      '/api/analytics/authors': () =>
        ok([
          { value: 'misha', label: 'Миша', count: 4 },
          { value: 'nastya', label: 'Настя', count: 2 },
        ]),
      '/api/rates': () => ok({ base: 'AMD', currencies: ['AMD', 'USD'], rates: [] }),
      '/api/config': () => ok({ currency: 'AMD' }),
      '/api/auth/me': () =>
        ok({ user: { username: 'misha', displayName: 'Миша', card: 'Миша', canEdit: true } }),
      '/api/sync/status': () =>
        ok({
          enabled: true,
          queued: 0,
          running: false,
          intervalMs: 1,
          nextRunAt: null,
          serverTime: '',
        }),
      '/api/cards': () => ok(['Миша', 'Настя']),
      '/api/categories': () => ok(['кафе', 'продукты']),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        harness.requests.push(method === 'GET' ? input : `${method} ${input}`);
        harness.bodies.push(init?.body === undefined ? undefined : JSON.parse(String(init.body)));
        const url = new URL(input, 'http://localhost');
        // Идентификатор записи в адресе заменяем на :id, чтобы обработчики не зависели от конкретных значений
        const path = url.pathname.replace(
          /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|\/id-[\w-]+/g,
          ':id',
        );
        const handler = harness.handlers[`${method} ${path}`] ?? harness.handlers[path];
        if (!handler) throw new Error(`Unexpected request: ${method} ${input}`);
        return handler(url);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function renderAnalytics(path = '/analytics') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="analytics/*" element={<AnalyticsRoutes />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
