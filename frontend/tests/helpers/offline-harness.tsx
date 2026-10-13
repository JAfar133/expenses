import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { AppShell } from '../../src/app/AppShell.tsx';
import type { AuthUser } from '../../src/features/auth/api/auth.api.ts';
import { AddExpensePage } from '../../src/pages/AddExpensePage.tsx';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const ok = (data: unknown, status = 200) => json(status, { success: true, data });
export const failure = (status: number, message: string, code = 'ERROR') =>
  json(status, { success: false, error: { code, message } });

export const USER: AuthUser = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  role: 'member',
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};

export interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body?: unknown;
}

/** A programmable server for the offline tests; `network = false` makes every request fail like a dead connection. */
export const server = {
  network: true,
  requests: [] as Recorded[],
  receiptSettings: { enabled: false, categories: [] } as {
    enabled: boolean;
    categories: string[];
    aiCategories?: string[];
  },
  postExpense: (_body: Record<string, unknown>, _headers: Headers): Response | Promise<Response> =>
    ok({ id: 'srv', excelStatus: 'synced', original: null }, 201),
  putReceipt: (_url: string): Response | Promise<Response> => ok({}),
  /** What /api/ai/status answers: by default the AI is off */
  aiStatus: { installationReady: false, groupEnabled: false, available: false },
  /** The history of names offered under the name field */
  nameSuggestions: [] as { name: string; category: string; count: number }[],
  /** What the user has saved in the preferences */
  preferences: {} as Record<string, unknown>,
  parseReceipt: (_url: string, _body: unknown): Response | Promise<Response> =>
    ok({
      nameFilled: true,
      dateFilled: true,
      itemsFilled: true,
      itemsOffered: false,
      dropped: 0,
      total: null,
      currency: null,
    }),
  /** The parse of a photo before saving (POST /api/ai/receipt/parse) */
  parsePhoto: (_photo: unknown): Response | Promise<Response> =>
    ok({
      parseId: 'p1',
      name: 'Кофейня',
      date: '2026-09-30',
      items: [{ name: 'Латте', price: 1500, quantity: 1 }],
      total: 1500.5,
      currency: 'AMD',
      dropped: 0,
    }),
  photoParses: () => server.requests.filter((r) => r.url.startsWith('/api/ai/receipt/parse')),
  parses: () =>
    server.requests.filter(
      (r) => r.url.endsWith('/receipt/parse') && !r.url.startsWith('/api/ai/'),
    ),
  posts: () => server.requests.filter((r) => r.method === 'POST' && r.url === '/api/expenses'),
  puts: () => server.requests.filter((r) => r.method === 'PUT'),
};

function resetServer() {
  server.network = true;
  server.requests = [];
  server.receiptSettings = { enabled: false, categories: [] };
  let counter = 0;
  server.postExpense = () =>
    ok({ id: `srv-${++counter}`, excelStatus: 'synced', original: null }, 201);
  server.putReceipt = () => ok({});
  server.aiStatus = { installationReady: false, groupEnabled: false, available: false };
  server.preferences = {};
  server.nameSuggestions = [];
  server.parseReceipt = () =>
    ok({
      nameFilled: true,
      dateFilled: true,
      itemsFilled: true,
      itemsOffered: false,
      dropped: 0,
      total: null,
      currency: null,
    });
  server.parsePhoto = () =>
    ok({
      parseId: 'p1',
      name: 'Кофейня',
      date: '2026-09-30',
      items: [{ name: 'Латте', price: 1500, quantity: 1 }],
      total: 1500.5,
      currency: 'AMD',
      dropped: 0,
    });
}

/** The AI is on for the installation and the group. */
export function enableAi() {
  server.aiStatus = { installationReady: true, groupEnabled: true, available: true };
}

export function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

/** Call in a test file: a fake server and a clean browser state for each test. */
export function setupOfflineHarness() {
  beforeEach(() => {
    resetServer();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (!server.network) throw new TypeError('Failed to fetch');
        server.requests.push({
          method,
          url,
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        });
        if (url === '/api/cards') {
          return ok([
            { name: 'Миша', currency: 'AMD' },
            { name: 'Настя', currency: 'AMD' },
          ]);
        }
        if (url === '/api/auth/refresh') return failure(401, 'Сессия истекла', 'UNAUTHORIZED');
        if (url === '/api/categories') return ok(['кафе', 'продукты']);
        if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
        if (url === '/api/rates') return failure(500, 'x');
        if (url === '/api/name-suggestions') return ok(server.nameSuggestions);
        if (url === '/api/budgets') return ok([]);
        if (url === '/api/receipts/settings') return ok(server.receiptSettings);
        if (url === '/api/ai/status') return ok(server.aiStatus);
        if (url === '/api/preferences' && method === 'GET') return ok(server.preferences);
        if (url === '/api/preferences' && method === 'PUT') {
          server.preferences = { ...server.preferences, ...JSON.parse(String(init?.body)) };
          return ok(server.preferences);
        }
        if (url.startsWith('/api/ai/receipt/parse') && method === 'POST')
          return server.parsePhoto(init?.body);
        if (url.endsWith('/receipt/parse') && method === 'POST') {
          return server.parseReceipt(url, JSON.parse(String(init?.body)));
        }
        if (url === '/api/sync/status') {
          return ok({
            enabled: false,
            queued: 0,
            running: false,
            intervalMs: 1,
            nextRunAt: null,
            serverTime: '',
          });
        }
        if (url.startsWith('/api/analytics/')) return failure(500, 'no analytics');
        if (url === '/api/expenses' && method === 'POST') {
          return server.postExpense(JSON.parse(String(init?.body)), new Headers(init?.headers));
        }
        if (/^\/api\/expenses\/[^/]+\/receipt$/.test(url) && method === 'PUT') {
          return server.putReceipt(url);
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    // React Query keeps its own online flag fed by the events
    onlineManager.setOnline(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

export type Person = ReturnType<typeof userEvent.setup>;

/** The whole page inside the app shell: banner, queue sender, queue block and the form. */
export async function renderApp(): Promise<{ person: Person; client: QueryClient }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell user={USER} />}>
            <Route index element={<AddExpensePage user={USER} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Добавить расход' });
  return { person: userEvent.setup(), client };
}

export async function fillForm(person: Person, name = 'Кофе', amount = '1000') {
  await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
  await person.type(screen.getByLabelText('Наименование'), name);
  await person.type(screen.getByLabelText('Стоимость'), amount);
}

export const submit = (person: Person) =>
  person.click(screen.getByRole('button', { name: 'Добавить расход' }));

export const stubImaging = () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
  );
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas'
      ? Object.assign(real('canvas'), {
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: BlobCallback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })),
        })
      : real(tag)) as typeof document.createElement);
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
};

/** The photo is allowed for the category «кафе». */
export function allowPhotos() {
  server.receiptSettings = { enabled: true, categories: ['кафе'] };
  stubImaging();
}

export async function pickPhoto(person: Person) {
  await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
  await person.upload(
    await screen.findByLabelText('Выбрать фото чека'),
    new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
  );
  await screen.findByAltText('Фото чека');
}
