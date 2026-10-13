import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroupPage from '../src/features/group/pages/GroupPage.tsx';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';
import { compressImage, fitSize, PHOTO_ERROR } from '../src/shared/utils/image-compress.ts';
import {
  harness,
  json,
  ok as analyticsOk,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => jsonResponse(status, { success: true, data });

const realCreateElement = document.createElement.bind(document);

/** A browser able to decode and re-encode images (jsdom cannot): the stubs record what the code asks for. */
function stubImaging(size = { width: 3200, height: 1600 }) {
  const canvas = { width: 0, height: 0 };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ ...size, close: vi.fn() })),
  );
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreateElement(tag);
    return Object.assign(canvas, {
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback, type?: string, quality?: number) => {
        toBlobArgs.push([type, quality]);
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
      },
    });
  }) as typeof document.createElement);
  return canvas;
}
let toBlobArgs: [string | undefined, number | undefined][] = [];

beforeEach(() => {
  toBlobArgs = [];
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('сжатие фото', () => {
  it('fitSize: большая сторона не больше 1600, пропорции сохраняются, малое не увеличивается', () => {
    expect(fitSize(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitSize(1200, 4800)).toEqual({ width: 400, height: 1600 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1600, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(fitSize(5000, 1)).toEqual({ width: 1600, height: 1 });
  });

  it('compressImage: учитывает ориентацию из EXIF, JPEG 0.8, размер по fitSize', async () => {
    const canvas = stubImaging();

    const blob = await compressImage(new Blob(['raw']));

    expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), {
      imageOrientation: 'from-image',
    });
    expect(canvas).toMatchObject({ width: 1600, height: 800 });
    expect(toBlobArgs).toEqual([['image/jpeg', 0.8]]);
    expect(blob.type).toBe('image/jpeg');
  });

  it('если файл не декодируется (HEIC в старом браузере), понятная ошибка', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('decode'))),
    );

    await expect(compressImage(new Blob(['x']))).rejects.toThrow(PHOTO_ERROR);
  });
});

describe('фото на форме «Добавить»', () => {
  let settings: { enabled: boolean; categories: string[] };
  let requests: { method: string; url: string; headers: Headers; body?: unknown }[];
  let receiptPut: () => Response;

  beforeEach(() => {
    settings = { enabled: true, categories: ['кафе'] };
    requests = [];
    receiptPut = () => ok({});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        requests.push({ method, url, headers: new Headers(init?.headers), body: init?.body });
        if (url === '/api/cards') return ok([{ name: 'Миша', currency: 'AMD' }]);
        if (url === '/api/categories') return ok(['кафе', 'продукты']);
        if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
        if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD'], rates: [] });
        if (url === '/api/name-suggestions' || url === '/api/budgets') return ok([]);
        if (url === '/api/receipts/settings') return ok(settings);
        if (url.startsWith('/api/analytics/')) throw new Error('no analytics');
        if (url === '/api/expenses' && method === 'POST')
          return ok({ id: 'e1', excelStatus: 'synced', original: null }, 201);
        if (url === '/api/expenses/e1/receipt' && method === 'PUT') return receiptPut();
        throw new Error(`Unexpected request: ${method} ${url}`);
      }),
    );
  });

  const user = {
    username: 'misha',
    displayName: 'Миша',
    card: 'Миша',
    canEdit: false,
    role: 'member' as const,
    isAdmin: false,
    timezone: 'Asia/Yerevan',
  };

  async function renderForm() {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <AddExpensePage user={user} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Добавить расход' });
    return userEvent.setup();
  }
  const pickPhoto = async (person: ReturnType<typeof userEvent.setup>) => {
    stubImaging();
    await person.upload(
      screen.getByLabelText('Выбрать фото чека'),
      new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
    );
  };
  const fill = async (person: ReturnType<typeof userEvent.setup>, category: string) => {
    await person.selectOptions(screen.getByLabelText('Категория'), category);
    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await person.type(screen.getByLabelText('Стоимость'), '1000');
  };

  it('функция выключена: кнопки нет даже в «подходящей» категории', async () => {
    settings = { enabled: false, categories: ['кафе'] };
    const person = await renderForm();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/receipts/settings')).toBe(true),
    );

    expect(screen.queryByRole('button', { name: 'Прикрепить фото чека' })).toBeNull();
  });

  it('включена: кнопка только в выбранных категориях', async () => {
    const person = await renderForm();
    expect(screen.queryByRole('button', { name: 'Прикрепить фото чека' })).toBeNull();

    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');
    expect(screen.queryByRole('button', { name: 'Прикрепить фото чека' })).toBeNull();

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    expect(await screen.findByRole('button', { name: 'Прикрепить фото чека' })).toBeInTheDocument();
  });

  it('фото: превью, крестик убирает; после сохранения трата уходит, затем PUT фото на её id', async () => {
    const person = await renderForm();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await screen.findByRole('button', { name: 'Прикрепить фото чека' });
    await pickPhoto(person);
    expect(await screen.findByAltText('Фото чека')).toBeInTheDocument();

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));
    expect(screen.queryByAltText('Фото чека')).toBeNull();
    await pickPhoto(person);
    await screen.findByAltText('Фото чека');
    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await person.type(screen.getByLabelText('Стоимость'), '1000');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/expenses/e1/receipt')).toBe(true),
    );
    const put = requests.find((r) => r.url === '/api/expenses/e1/receipt')!;
    expect(put.method).toBe('PUT');
    expect(put.headers.get('Content-Type')).toBe('image/jpeg');
    expect(put.body).toBeInstanceOf(Blob);
    const order = requests.map((r) => `${r.method} ${r.url}`);
    expect(order.indexOf('POST /api/expenses')).toBeLessThan(
      order.indexOf('PUT /api/expenses/e1/receipt'),
    );
    expect(await screen.findByText('Расход успешно добавлен')).toBeInTheDocument();
    expect(screen.queryByText(/фото не загрузилось/)).toBeNull();
  });

  it('если фото не загрузилось, расход всё равно сохранён и показано спокойное сообщение', async () => {
    receiptPut = () =>
      jsonResponse(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } });
    const person = await renderForm();
    await fill(person, 'кафе');
    await screen.findByRole('button', { name: 'Прикрепить фото чека' });
    await pickPhoto(person);
    await screen.findByAltText('Фото чека');

    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    expect(await screen.findByText(/Расход сохранён, но фото не загрузилось/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // The form is ready for the next expense
    expect(screen.getByLabelText('Наименование')).toHaveValue('');
  });

  it('без фото второго запроса нет; фото не уходит, если категория сменена на неподходящую', async () => {
    const person = await renderForm();
    await fill(person, 'кафе');
    await screen.findByRole('button', { name: 'Прикрепить фото чека' });
    await pickPhoto(person);
    await screen.findByAltText('Фото чека');
    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');

    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await screen.findByText('Расход успешно добавлен');
    expect(requests.some((r) => r.url.endsWith('/receipt'))).toBe(false);
  });

  it('не удалось обработать файл: сообщение, форма работает', async () => {
    const person = await renderForm();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await screen.findByRole('button', { name: 'Прикрепить фото чека' });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('heic'))),
    );

    await person.upload(
      screen.getByLabelText('Выбрать фото чека'),
      new File(['img'], 'check.heic', { type: 'image/heic' }),
    );

    expect(await screen.findByText(PHOTO_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeEnabled();
  });
});

describe('фото в «Операциях»', () => {
  setupAnalyticsHarness();

  const item = (overrides: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-000000000001',
    date: '2026-10-10',
    card: 'Миша',
    category: 'кафе',
    name: 'Кофе',
    amount: 1000,
    currency: 'AMD',
    original: null,
    editable: true,
    editableUntil: null,
    hasReceipt: false,
    createdBy: 'misha',
    source: 'app',
    excelState: 'synced',
    excelError: null,
    deletedAt: null,
    deletedReason: null,
    updatedBy: null,
    ...overrides,
  });
  const serve = (items: unknown[]) =>
    (harness.handlers['/api/expenses'] = () =>
      analyticsOk({ items, total: items.length, totalAmount: 0 }));
  const allowCafe = () =>
    (harness.handlers['/api/receipts/settings'] = () =>
      analyticsOk({ enabled: true, categories: ['кафе'] }));
  const row = () =>
    within(screen.getByRole('table', { name: 'Операции' }))
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Кофе'))!;
  const url = '/api/expenses/00000000-0000-4000-8000-000000000001/receipt';
  const OPS = '/analytics/operations';

  async function openEditor(user: ReturnType<typeof renderAnalytics>) {
    await user.click(await within(row()).findByRole('button', { name: 'Изменить запись: Кофе' }));
    return within(await screen.findByRole('dialog', { name: 'Изменить запись' }));
  }

  it('значок есть только у записи с фото; клик открывает фото в окне', async () => {
    serve([item({ hasReceipt: true }), item({ id: 'x2', name: 'Чай' })]);
    const user = renderAnalytics(OPS);
    await waitFor(() => row());

    expect(
      within(screen.getByRole('table', { name: 'Операции' })).getAllByRole('button', {
        name: 'Есть фото чека',
      }),
    ).toHaveLength(1);
    await user.click(within(row()).getByRole('button', { name: 'Есть фото чека' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Фото чека' }));
    expect(dialog.getByRole('img', { name: 'Фото чека' })).toHaveAttribute('src', url);
    await user.click(dialog.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('камера стоит в одной flex-строке с названием в ячейке таблицы (не сдвигает строку)', async () => {
    serve([item({ hasReceipt: true })]);
    renderAnalytics(OPS);
    await waitFor(() => row());

    const badge = within(row()).getByRole('button', { name: 'Есть фото чека' });
    const line = badge.parentElement!;
    expect(line).toHaveClass('flex', 'items-center');
    expect(within(line).getByText('Кофе')).toBeInTheDocument();
    expect(line.parentElement?.tagName).toBe('TH');
  });

  it('в окне правки: фото, «Заменить» шлёт PUT, список обновляется', async () => {
    harness.handlers['/api/auth/me'] = () =>
      analyticsOk({
        user: { username: 'misha', displayName: 'Миша', card: 'Миша', canEdit: true },
      });
    serve([item({ hasReceipt: true })]);
    harness.handlers[`PUT ${url.replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/, ':id')}`] =
      () => analyticsOk({});
    stubImaging();
    const user = renderAnalytics(OPS);
    await waitFor(() => row());
    const dialog = await openEditor(user);
    expect(dialog.getByAltText('Фото чека')).toBeInTheDocument();
    const listBefore = harness.requests.filter((r) => r.startsWith('/api/expenses?')).length;

    await user.upload(
      dialog.getByLabelText('Выбрать фото чека'),
      new File(['img'], 'new.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => expect(harness.requests).toContain(`PUT ${url}`));
    await waitFor(() =>
      expect(harness.requests.filter((r) => r.startsWith('/api/expenses?')).length).toBeGreaterThan(
        listBefore,
      ),
    );
  });

  it('«Убрать» шлёт DELETE, после этого можно прикрепить заново', async () => {
    serve([item({ hasReceipt: true })]);
    harness.handlers['DELETE /api/expenses/:id/receipt'] = () => analyticsOk({});
    allowCafe();
    const user = renderAnalytics(OPS);
    await waitFor(() => row());
    const dialog = await openEditor(user);

    await user.click(dialog.getByRole('button', { name: 'Убрать' }));

    await waitFor(() => expect(harness.requests).toContain(`DELETE ${url}`));
    expect(await dialog.findByRole('button', { name: 'Прикрепить' })).toBeInTheDocument();
    expect(dialog.queryByAltText('Фото чека')).toBeNull();
  });

  it('«Прикрепить» есть, если категория записи входит в список', async () => {
    serve([item()]);
    allowCafe();
    const user = renderAnalytics(OPS);
    await waitFor(() => row());
    const dialog = await openEditor(user);

    expect(await dialog.findByRole('button', { name: 'Прикрепить' })).toBeInTheDocument();
  });

  it('категория записи не в списке и фото нет: блока нет', async () => {
    serve([item({ category: 'продукты' })]);
    allowCafe();
    const user = renderAnalytics(OPS);
    await waitFor(() => row());
    const dialog = await openEditor(user);

    expect(dialog.queryByRole('button', { name: 'Прикрепить' })).toBeNull();
    expect(dialog.queryByText('Фото чека')).toBeNull();
  });

  it('функция выключена и фото нет: в окне правки блока нет', async () => {
    serve([item()]);
    const user = renderAnalytics(OPS);
    await waitFor(() => row());
    const dialog = await openEditor(user);

    expect(dialog.queryByText('Фото чека')).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Прикрепить' })).toBeNull();
  });

  it('ошибка сервера при замене показывается в окне', async () => {
    serve([item({ hasReceipt: true })]);
    harness.handlers[`PUT /api/expenses/:id/receipt`] = () =>
      json(
        {
          success: false,
          error: {
            code: 'EDIT_WINDOW_CLOSED',
            message: 'Срок, когда эту трату можно исправить, истёк',
          },
        },
        403,
      );
    stubImaging();
    const user = renderAnalytics(OPS);
    await waitFor(() => row());
    const dialog = await openEditor(user);

    await user.upload(
      dialog.getByLabelText('Выбрать фото чека'),
      new File(['i'], 'a.jpg', { type: 'image/jpeg' }),
    );

    expect(
      await dialog.findByText('Срок, когда эту трату можно исправить, истёк'),
    ).toBeInTheDocument();
  });
});

describe('«Фото чеков» в настройках группы', () => {
  let settings: { enabled: boolean; categories: string[] };
  let requests: { method: string; url: string; body?: Record<string, unknown> }[];
  let putResponse: (() => Response) | undefined;

  beforeEach(() => {
    settings = { enabled: false, categories: [] };
    requests = [];
    putResponse = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method, url, body });
        if (url === '/api/auth/me')
          return ok({
            user: {
              username: 'misha',
              displayName: 'Миша',
              card: 'Миша',
              canEdit: true,
              timezone: 'Asia/Yerevan',
              role: 'owner',
              isAdmin: false,
            },
          });
        if (url === '/api/group')
          return ok({
            group: {
              id: 1,
              name: 'Семья',
              reportingCurrency: 'AMD',
              timezone: 'Asia/Yerevan',
              disabled: false,
            },
            currencies: ['AMD'],
            members: [],
            cards: [],
            categories: [
              { id: 1, name: 'кафе', archived: false },
              { id: 2, name: 'продукты', archived: false },
              { id: 3, name: 'старая', archived: true },
            ],
            invitations: [],
          });
        if (url === '/api/receipts/settings') return ok(settings);
        if (url === '/api/group/receipts' && method === 'PUT') {
          if (putResponse) return putResponse();
          settings = body;
          return ok({});
        }
        return ok(url === '/api/budgets' ? [] : {});
      }),
    );
  });

  async function renderGroup() {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/group']}>
          <Routes>
            <Route path="group" element={<GroupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const heading = await screen.findByRole('heading', { name: 'Настройки группы' });
    return { person: userEvent.setup(), box: within(heading.closest('section')!) };
  }
  const puts = () => requests.filter((r) => r.method === 'PUT' && r.url === '/api/group/receipts');

  it('выключено: переключатель без чипов категорий; включение отправляет PUT', async () => {
    const { person, box } = await renderGroup();
    expect(await box.findByRole('switch', { name: 'Разрешить фото чеков' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(box.queryByRole('group', { name: 'Категории с фото чека' })).toBeNull();

    await person.click(await box.findByRole('switch', { name: 'Разрешить фото чеков' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: true, categories: [] });
    expect(await box.findByRole('group', { name: 'Категории с фото чека' })).toBeInTheDocument();
  });

  it('включено: чипы только неархивных категорий; выбор и снятие сохраняются сразу', async () => {
    settings = { enabled: true, categories: ['кафе'] };
    const { person, box } = await renderGroup();
    const group = await box.findByRole('group', { name: 'Категории с фото чека' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['кафе', 'продукты']);
    expect(within(group).getByRole('button', { name: 'кафе' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await person.click(within(group).getByRole('button', { name: 'продукты' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: true, categories: ['кафе', 'продукты'] });

    await person.click(await within(group).findByRole('button', { name: 'кафе' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]!.body).toEqual({ enabled: true, categories: ['продукты'] });
  });

  it('ошибка сервера показывается', async () => {
    putResponse = () =>
      jsonResponse(403, {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Только владелец' },
      });
    const { person, box } = await renderGroup();

    await person.click(await box.findByRole('switch', { name: 'Разрешить фото чеков' }));

    expect(await box.findByRole('alert')).toHaveTextContent('Только владелец');
  });
});
