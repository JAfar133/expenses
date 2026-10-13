import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from '../src/features/admin/pages/AdminPage.tsx';
import { keyStatusText } from '../src/features/admin/components/AiKeyForm.tsx';
import GroupPage from '../src/features/group/pages/GroupPage.tsx';

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
const OWNER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
  role: 'owner',
  isAdmin: false,
};

const adminAi = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  model: 'gemini-3.8-flash',
  dailyLimit: 50,
  keyConfigured: true,
  keySource: 'app',
  keyHint: '1234',
  canStoreKey: true,
  usage: { today: 3, month: 41, errorsMonth: 2 },
  groups: [
    { id: 1, name: 'Семья', enabled: true, dailyLimit: null, usedToday: 2 },
    { id: 2, name: 'Соседи', enabled: false, dailyLimit: 10, usedToday: 0 },
  ],
  ...overrides,
});

let me: Record<string, unknown>;
let aiState: ReturnType<typeof adminAi>;
let receiptSettings: Record<string, unknown>;
let status: { installationReady: boolean; groupEnabled: boolean; available: boolean };
let requests: { method: string; url: string; body?: Record<string, unknown> }[];
let respond: (method: string, url: string) => Response | undefined;

beforeEach(() => {
  me = ADMIN;
  aiState = adminAi();
  status = { installationReady: true, groupEnabled: false, available: false };
  receiptSettings = { enabled: false, categories: [] };
  requests = [];
  respond = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const forced = respond(method, url);
      if (forced) return forced;
      if (url === '/api/auth/me') return ok({ user: me });
      if (url === '/api/admin/ai' && method === 'GET') return ok(aiState);
      if (url === '/api/ai/status') return ok(status);
      if (url === '/api/admin/groups' && method === 'GET') return ok([]);
      if (url === '/api/admin/backup') return ok({ configured: false, state: 'unknown' });
      if (url === '/api/admin/sync') return ok({ configured: false, enabled: false });
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD'], rates: [] });
      if (url === '/api/group' && method === 'GET') {
        return ok({
          group: {
            id: 1,
            name: 'Семья',
            reportingCurrency: 'AMD',
            timezone: 'Asia/Yerevan',
            disabled: false,
            memberEditMinutes: 1440,
          },
          currencies: ['AMD'],
          members: [
            { userId: 1, username: 'misha', displayName: 'Миша', role: 'owner', fromEnv: true },
          ],
          cards: [],
          categories: [
            { id: 20, name: 'Еда', archived: false },
            { id: 21, name: 'Жильё', archived: false },
            { id: 22, name: 'Прочее', archived: false },
          ],
          invitations: [],
        });
      }
      if (url === '/api/budgets') return ok([]);
      if (url === '/api/receipts/settings') return ok(receiptSettings);
      if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
      return ok({});
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="admin" element={<AdminPage />} />
          <Route path="group" element={<GroupPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const block = async () => {
  const heading = await screen.findByRole('heading', { name: 'ИИ (Gemini)' });
  await screen.findByRole('region', { name: 'Группы' });
  return within(heading.closest('section')!);
};
const sent = (method: string, url: string) =>
  requests.find((r) => r.method === method && r.url === url)?.body;
const did = (method: string, url: string) =>
  requests.some((r) => r.method === method && r.url === url);
const noKey = { keyConfigured: false, keySource: 'none', keyHint: null, enabled: false };

describe('админ: статус и переключатель', () => {
  it.each([
    [noKey, 'Не настроено', 'Сначала задайте ключ'],
    [{ enabled: false }, 'Ключ задан, ИИ выключен', 'Выключено'],
    [{ enabled: true }, 'Работает', 'Включено'],
  ])('состояние %o: «%s», подпись «%s»', async (patch, label, caption) => {
    aiState = adminAi(patch);
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('status')).toHaveTextContent(label);
    expect(ai.getByText(caption)).toBeInTheDocument();
  });

  it('без ключа переключатель неактивен', async () => {
    aiState = adminAi(noKey);
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('switch', { name: 'ИИ для установки' })).toBeDisabled();
  });

  it('с ключом переключатель включает и выключает ИИ', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('switch', { name: 'ИИ для установки' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai')).toEqual({ enabled: false }));
  });

  it('«Ошибка» (красный) — только после неудачной проверки', async () => {
    respond = (method, url) =>
      method === 'POST' && url === '/api/admin/ai/test'
        ? json(
            { success: false, error: { code: 'AI_UNAVAILABLE', message: 'Ключ не принят' } },
            400,
          )
        : undefined;
    const user = renderAt('/admin');
    const ai = await block();
    expect(ai.getByRole('status')).toHaveTextContent('Работает');

    await user.click(ai.getByRole('button', { name: 'Проверить' }));

    await waitFor(() => expect(ai.getByRole('status')).toHaveTextContent('Ошибка'));
    expect(ai.getByRole('alert')).toHaveTextContent('Ключ не принят');
  });
});

describe('админ: шаг 1, API-ключ', () => {
  it('ключ задан: хвост и источник, три действия включены', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByText('Ключ задан …1234 · из приложения')).toBeInTheDocument();
    for (const name of ['Проверить', 'Заменить', 'Удалить']) {
      expect(ai.getByRole('button', { name })).toBeEnabled();
    }
    expect(ai.queryByLabelText('API-ключ Gemini')).toBeNull();
  });

  it('ключа нет: поле-пароль без значения, «Сохранить ключ» неактивна, пока ничего не введено', async () => {
    aiState = adminAi(noKey);
    renderAt('/admin');
    const ai = await block();

    const field = ai.getByLabelText('API-ключ Gemini');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveValue('');
    expect(ai.getByRole('button', { name: 'Сохранить ключ' })).toBeDisabled();
    expect(ai.getByText('Ключ не задан', { selector: 'p' })).toBeInTheDocument();
  });

  it('«Показать» и «Скрыть» переключают вид ключа', async () => {
    aiState = adminAi(noKey);
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Показать ключ' }));
    expect(ai.getByLabelText('API-ключ Gemini')).toHaveAttribute('type', 'text');
    await user.click(ai.getByRole('button', { name: 'Скрыть ключ' }));

    expect(ai.getByLabelText('API-ключ Gemini')).toHaveAttribute('type', 'password');
  });

  it('«Сохранить ключ» шлёт ключ и очищает поле', async () => {
    aiState = adminAi(noKey);
    const user = renderAt('/admin');
    const ai = await block();

    await user.type(ai.getByLabelText('API-ключ Gemini'), 'SECRET-KEY');
    await user.click(ai.getByRole('button', { name: 'Сохранить ключ' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai/key')).toEqual({ apiKey: 'SECRET-KEY' }));
    await waitFor(() => expect(ai.getByLabelText('API-ключ Gemini')).toHaveValue(''));
  });

  it('«Заменить» показывает поле, «Отмена» его убирает, сохранение шлёт новый ключ', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Заменить' }));
    await user.click(ai.getByRole('button', { name: 'Отмена' }));
    expect(ai.queryByLabelText('API-ключ Gemini')).toBeNull();

    await user.click(ai.getByRole('button', { name: 'Заменить' }));
    await user.type(ai.getByLabelText('API-ключ Gemini'), 'NEW-KEY');
    await user.click(ai.getByRole('button', { name: 'Сохранить ключ' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai/key')).toEqual({ apiKey: 'NEW-KEY' }));
    await waitFor(() => expect(ai.queryByLabelText('API-ключ Gemini')).toBeNull());
  });

  it('«Удалить» вызывает DELETE', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(did('DELETE', '/api/admin/ai/key')).toBe(true));
  });

  it('«Проверить»: спиннер, затем сообщение сервера с галочкой', async () => {
    let finish: (response: Response) => void = () => undefined;
    respond = (method, url) =>
      method === 'POST' && url === '/api/admin/ai/test'
        ? (new Promise<Response>((resolve) => (finish = resolve)) as unknown as Response)
        : undefined;
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Проверить' }));
    expect(await ai.findByText('Проверяем…')).toBeInTheDocument();
    finish(ok({ message: 'Ключ работает' }));

    expect(await ai.findByText('Ключ работает')).toBeInTheDocument();
  });

  it('нет SECRETS_KEY: жёлтая плашка с командой, поле и «Заменить» отключены с пояснением', async () => {
    aiState = adminAi({ canStoreKey: false });
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('note')).toHaveTextContent(
      /На сервере не задан SECRETS_KEY, ключ из приложения сохранить нельзя/,
    );
    expect(ai.getByText('openssl rand -base64 36').tagName).toBe('CODE');
    expect(ai.getByRole('button', { name: 'Заменить' })).toBeDisabled();
    expect(ai.getByRole('button', { name: 'Заменить' })).toHaveAttribute(
      'title',
      'Нужен SECRETS_KEY на сервере',
    );
  });

  it('нет SECRETS_KEY и нет ключа: поле и кнопка сохранения отключены', async () => {
    aiState = adminAi({ ...noKey, canStoreKey: false });
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByLabelText('API-ключ Gemini')).toBeDisabled();
    expect(ai.getByRole('button', { name: 'Сохранить ключ' })).toBeDisabled();
  });

  it('ключ из окружения: пояснение, «Удалить» неактивна с подсказкой', async () => {
    aiState = adminAi({ keySource: 'env' });
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByText('Ключ задан …1234 · из окружения')).toBeInTheDocument();
    expect(ai.getByText(/Чтобы заменить его в приложении, нужен SECRETS_KEY/)).toBeInTheDocument();
    const remove = ai.getByRole('button', { name: 'Удалить' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', expect.stringContaining('окружении'));
  });

  it('тексты состояния ключа', () => {
    expect(keyStatusText({ keyConfigured: true, keySource: 'env', keyHint: 'abcd' })).toBe(
      'Ключ задан …abcd · из окружения',
    );
    expect(keyStatusText({ keyConfigured: false, keySource: 'none', keyHint: null })).toBe(
      'Ключ не задан',
    );
  });
});

describe('админ: параметры, использование, группы', () => {
  it('«Дополнительно» свёрнуто: видно только строка с текущими значениями', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.queryByLabelText('Модель')).toBeNull();
    expect(
      ai.getByText(/Модель gemini-3.8-flash · лимит 50 в сутки на группу/),
    ).toBeInTheDocument();
  });

  it('одна форма и одна кнопка «Сохранить»: активна при изменениях, шлёт модель и лимит вместе', async () => {
    const user = renderAt('/admin');
    const ai = await block();
    await user.click(ai.getByRole('button', { name: /Дополнительно/ }));
    expect(ai.getByLabelText('Модель')).toHaveValue('gemini-3.8-flash');
    expect(ai.getByLabelText('Лимит')).toHaveValue('50');
    expect(ai.getByText('Сколько чеков группа может разобрать за сутки')).toBeInTheDocument();
    expect(ai.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await user.type(ai.getByLabelText('Модель'), '-pro');
    await user.clear(ai.getByLabelText('Лимит'));
    await user.type(ai.getByLabelText('Лимит'), '80');
    await user.click(ai.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/admin/ai')).toEqual({
        model: 'gemini-3.8-flash-pro',
        dailyLimit: 80,
      }),
    );
  });

  it('три плитки использования', async () => {
    renderAt('/admin');
    const ai = await block();

    const usage = within(ai.getByRole('region', { name: 'Использование' }));
    expect(usage.getByText('Сегодня').nextSibling).toHaveTextContent('3');
    expect(usage.getByText('За 30 дней').nextSibling).toHaveTextContent('41');
    expect(usage.getByText('Ошибок за 30 дней').nextSibling).toHaveTextContent('2');
  });

  it('группы: состояние, «сегодня разобрано N из L» (свой или общий лимит)', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByText(/ИИ включён владельцем · сегодня разобрано 2 из 50/)).toBeInTheDocument();
    expect(ai.getByText(/ИИ выключен владельцем · сегодня разобрано 0 из 10/)).toBeInTheDocument();
    expect(ai.getByLabelText('Лимит разборов в сутки: Семья')).toHaveAttribute(
      'placeholder',
      'как у всех (50)',
    );
  });

  it('одна группа тоже показывается', async () => {
    aiState = adminAi({
      groups: [{ id: 1, name: 'Семья', enabled: true, dailyLimit: null, usedToday: 1 }],
    });
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByText('Семья')).toBeInTheDocument();
  });

  it('лимит группы сохраняется по Enter', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.type(ai.getByLabelText('Лимит разборов в сутки: Семья'), '25{Enter}');

    await waitFor(() => expect(sent('PUT', '/api/admin/groups/1/ai-limit')).toEqual({ limit: 25 }));
  });

  it('лимит группы сохраняется при уходе из поля', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.type(ai.getByLabelText('Лимит разборов в сутки: Семья'), '30');
    await user.tab();

    await waitFor(() => expect(sent('PUT', '/api/admin/groups/1/ai-limit')).toEqual({ limit: 30 }));
  });

  it('кнопка-иконка с галочкой появляется при изменении и сохраняет', async () => {
    const user = renderAt('/admin');
    const ai = await block();
    expect(ai.queryByRole('button', { name: 'Сохранить лимит: Семья' })).toBeNull();

    await user.type(ai.getByLabelText('Лимит разборов в сутки: Семья'), '12');
    await user.click(ai.getByRole('button', { name: 'Сохранить лимит: Семья' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/groups/1/ai-limit')).toEqual({ limit: 12 }));
    expect(requests.filter((r) => r.url === '/api/admin/groups/1/ai-limit')).toHaveLength(1);
  });

  it('очистка своего лимита возвращает общий: limit = null', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.clear(ai.getByLabelText('Лимит разборов в сутки: Соседи'));
    await user.tab();

    await waitFor(() =>
      expect(sent('PUT', '/api/admin/groups/2/ai-limit')).toEqual({ limit: null }),
    );
  });
});

describe('«Настройки группы»: разбор чеков с помощью ИИ', () => {
  const row = async () => screen.findByRole('switch', { name: 'Разбор чеков с помощью ИИ' });
  beforeEach(() => {
    me = OWNER;
  });

  it('админ включил ИИ: переключатель доступен с пояснением про Google (Gemini)', async () => {
    renderAt('/group');

    const toggle = await row();
    expect(toggle).toBeEnabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Фото чека отправляется в Google \(Gemini\)/)).toBeInTheDocument();
  });

  it('переключение шлёт PUT /group/ai', async () => {
    const user = renderAt('/group');

    await user.click(await row());

    await waitFor(() => expect(sent('PUT', '/api/group/ai')).toEqual({ enabled: true }));
  });

  it('включено в группе: переключатель отмечен', async () => {
    status = { installationReady: true, groupEnabled: true, available: true };
    renderAt('/group');

    expect(await row()).toBeChecked();
  });

  it('ИИ не включён администратором или нет ключа: переключатель неактивен, подпись «Выключено администратором»', async () => {
    me = OWNER;
    status = { installationReady: false, groupEnabled: true, available: false };
    renderAt('/group');

    const toggle = await row();
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Выключено администратором')).toBeInTheDocument();
  });
});

describe('админ: лимит группы понятно', () => {
  it('подпись «Лимит в сутки», placeholder с общим лимитом, пояснение в title', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.getAllByText('Лимит в сутки')).toHaveLength(2);
    const field = ai.getByLabelText('Лимит разборов в сутки: Семья');
    expect(field).toHaveAttribute('placeholder', 'как у всех (50)');
    expect(field.closest('[title]')).toHaveAttribute(
      'title',
      'Сколько чеков эта группа может разобрать за сутки. Пусто: действует общий лимит',
    );
  });

  it('у группы со своим лимитом — пометка «свой лимит» и «Сбросить» (limit: null); у остальных нет', async () => {
    const user = renderAt('/admin');
    const ai = await block();
    expect(ai.queryByRole('button', { name: 'Сбросить лимит: Семья' })).toBeNull();
    expect(ai.getAllByText(/свой лимит/)).toHaveLength(1);

    await user.click(ai.getByRole('button', { name: 'Сбросить лимит: Соседи' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/admin/groups/2/ai-limit')).toEqual({ limit: null }),
    );
    await waitFor(() =>
      expect(ai.getByLabelText('Лимит разборов в сутки: Соседи')).toHaveValue(''),
    );
  });
});

describe('«Фото чека»: разбор ИИ по категориям', () => {
  beforeEach(() => {
    me = OWNER;
    status = { installationReady: true, groupEnabled: true, available: true };
    receiptSettings = {
      enabled: true,
      categories: ['Еда', 'Жильё'],
      aiCategories: ['Еда', 'Жильё', 'Прочее'],
    };
  });

  const aiGroup = async () =>
    within(await screen.findByRole('group', { name: 'Категории с разбором ИИ' }));

  it('ИИ готов: показывает только категории с фото, с подсказкой; включены те, что в aiCategories', async () => {
    renderAt('/group');
    const group = await aiGroup();

    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['Еда', 'Жильё']);
    expect(group.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Категории, где ИИ читает чеки')).toBeInTheDocument();
    expect(screen.getByText('Выключите для категорий, где это не нужно')).toBeInTheDocument();
  });

  it('выключение категории сохраняется с aiCategories (фото-категории не меняются)', async () => {
    const user = renderAt('/group');
    const group = await aiGroup();

    await user.click(group.getByRole('button', { name: 'Жильё' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/group/receipts')).toEqual({
        enabled: true,
        categories: ['Еда', 'Жильё'],
        aiCategories: ['Еда', 'Прочее'],
      }),
    );
  });

  it('включение обратно добавляет категорию в aiCategories', async () => {
    receiptSettings = { enabled: true, categories: ['Еда', 'Жильё'], aiCategories: ['Еда'] };
    const user = renderAt('/group');
    const group = await aiGroup();
    expect(group.getByRole('button', { name: 'Жильё' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(group.getByRole('button', { name: 'Жильё' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/group/receipts')).toMatchObject({ aiCategories: ['Еда', 'Жильё'] }),
    );
  });

  it('переключение фото-категории шлёт и актуальный список aiCategories', async () => {
    const user = renderAt('/group');
    const photos = within(await screen.findByRole('group', { name: 'Категории с фото чека' }));

    await user.click(await photos.findByRole('button', { name: 'Прочее' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/group/receipts')).toMatchObject({
        categories: ['Еда', 'Жильё', 'Прочее'],
        aiCategories: ['Еда', 'Жильё', 'Прочее'],
      }),
    );
  });

  it('ИИ не готов (не включён администратором): блока выбора нет', async () => {
    status = { installationReady: false, groupEnabled: false, available: false };
    renderAt('/group');
    await screen.findByRole('group', { name: 'Категории с фото чека' });

    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
  });

  it('без категорий с фото блока выбора нет', async () => {
    receiptSettings = { enabled: true, categories: [], aiCategories: [] };
    renderAt('/group');
    await screen.findByRole('group', { name: 'Категории с фото чека' });

    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
  });
});

describe('«Настройки группы»: компоновка рядов с категориями', () => {
  beforeEach(() => {
    me = OWNER;
    status = { installationReady: true, groupEnabled: true, available: true };
    receiptSettings = { enabled: true, categories: ['Еда', 'Жильё'], aiCategories: ['Еда'] };
  });

  it('у обоих рядов чипов есть подписи', async () => {
    renderAt('/group');

    expect(await screen.findByText('Категории, где можно прикреплять фото')).toBeInTheDocument();
    expect(screen.getByText('Категории, где ИИ читает чеки')).toBeInTheDocument();
  });

  it('ряд ИИ идёт сразу за рядом фото и принадлежит переключателю ИИ', async () => {
    renderAt('/group');
    await screen.findByRole('group', { name: 'Категории с разбором ИИ' });

    const rows = screen
      .getAllByRole('switch')
      .map((toggle) => toggle.closest<HTMLElement>('.py-3\\.5')!);
    const [photo, ai] = [
      rows.find((row) => within(row).queryByRole('switch', { name: 'Разрешить фото чеков' }))!,
      rows.find((row) => within(row).queryByRole('switch', { name: 'Разбор чеков с помощью ИИ' }))!,
    ];
    expect(photo.nextElementSibling).toBe(ai);
    expect(within(photo).getByRole('group', { name: 'Категории с фото чека' })).toBeInTheDocument();
    expect(within(ai).getByRole('group', { name: 'Категории с разбором ИИ' })).toBeInTheDocument();
  });

  it('чипы в обоих рядах одного стиля: выбранные заливкой, невыбранные контуром', async () => {
    renderAt('/group');
    const ai = within(await screen.findByRole('group', { name: 'Категории с разбором ИИ' }));
    const photos = within(screen.getByRole('group', { name: 'Категории с фото чека' }));

    for (const chip of [
      ai.getByRole('button', { name: 'Еда' }),
      photos.getByRole('button', { name: 'Еда' }),
    ]) {
      expect(chip.className).toContain('bg-indigo-600');
    }
    for (const chip of [
      ai.getByRole('button', { name: 'Жильё' }),
      photos.getByRole('button', { name: 'Прочее' }),
    ]) {
      expect(chip.className).toContain('border-zinc-300');
      expect(chip.className).not.toContain('bg-indigo-600');
    }
  });

  it('переключатель ИИ выключен: чипов ИИ нет', async () => {
    status = { installationReady: true, groupEnabled: false, available: false };
    renderAt('/group');
    await screen.findByRole('group', { name: 'Категории с фото чека' });

    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
    expect(screen.queryByText('Категории, где ИИ читает чеки')).toBeNull();
  });
});
