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
      if (url === '/api/budgets' || url === '/api/templates') return ok([]);
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
          <Route path="group/*" element={<GroupPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const block = async () => {
  const heading = await screen.findByRole('heading', { name: 'ИИ (Gemini)' });
  await screen.findByRole('region', { name: 'Использование' });
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
    [{ enabled: false }, 'Ключ задан, ИИ выключен', 'Автоматическое распознавание чеков'],
    [{ enabled: true }, 'Работает', 'Автоматическое распознавание чеков'],
  ])('состояние %o: чип «%s», подпись «%s»', async (patch, label, caption) => {
    aiState = adminAi(patch);
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('status')).toHaveTextContent(label);
    expect(ai.getByText(caption)).toBeInTheDocument();
  });

  it('чип статуса справа в заголовке карточки', async () => {
    renderAt('/admin');
    const ai = await block();

    const heading = ai.getByRole('heading', { name: 'ИИ (Gemini)' });
    expect(heading.parentElement).toContainElement(ai.getByRole('status'));
  });

  it('без ключа переключатель неактивен', async () => {
    aiState = adminAi(noKey);
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('switch', { name: 'Использовать ИИ для установки' })).toBeDisabled();
  });

  it('с ключом переключатель включает и выключает ИИ', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('switch', { name: 'Использовать ИИ для установки' }));

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

describe('админ: список настроек и окна', () => {
  it('одна тонированная рамка со строками «Модель», «Лимит чеков в сутки», «API-ключ»', async () => {
    renderAt('/admin');
    const ai = await block();

    const model = ai.getByRole('button', { name: /^Модель/ });
    expect(model).toHaveTextContent('gemini-3.8-flash');
    expect(ai.getByRole('button', { name: /^Лимит чеков в сутки/ })).toHaveTextContent('50');
    expect(ai.getByRole('button', { name: /^API-ключ/ })).toHaveTextContent('…1234');
    expect(model.parentElement!.className).toContain('bg-zinc-50');
  });

  it('«Модель» открывает окно; «Сохранить» шлёт модель', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: /^Модель/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Модель' }));
    expect(
      dialog.getByText('Идентификатор Gemini, по умолчанию gemini-3.8-flash'),
    ).toBeInTheDocument();
    const field = dialog.getByLabelText('Модель');
    await user.clear(field);
    await user.type(field, 'gemini-x');
    await user.click(dialog.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai')).toEqual({ model: 'gemini-x' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Модель' })).toBeNull());
  });

  it('«Лимит чеков в сутки»: числовое поле, сохранение числом', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: /^Лимит чеков в сутки/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Лимит чеков в сутки' }));
    expect(dialog.getByText('Сколько чеков группа может разобрать за сутки')).toBeInTheDocument();
    const field = dialog.getByLabelText('Лимит чеков в сутки');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    await user.clear(field);
    await user.type(field, '80');
    await user.click(dialog.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai')).toEqual({ dailyLimit: 80 }));
  });

  it('«Сохранить» неактивна при пустом поле', async () => {
    const user = renderAt('/admin');
    const ai = await block();
    await user.click(ai.getByRole('button', { name: /^Модель/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Модель' }));

    await user.clear(dialog.getByLabelText('Модель'));

    expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('«API-ключ» открывает окно: поле-пароль «Новый ключ» без значения; сохранение шлёт ключ', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: /^API-ключ/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'API-ключ' }));
    const field = dialog.getByLabelText('Новый ключ');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveValue('');
    expect(dialog.getByRole('button', { name: 'Сохранить ключ' })).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'Показать ключ' }));
    expect(field).toHaveAttribute('type', 'text');
    await user.type(field, 'SECRET-KEY');
    await user.click(dialog.getByRole('button', { name: 'Сохранить ключ' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai/key')).toEqual({ apiKey: 'SECRET-KEY' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'API-ключ' })).toBeNull());
  });

  it('«Заменить» открывает то же окно ключа', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Заменить' }));

    expect(await screen.findByRole('dialog', { name: 'API-ключ' })).toBeInTheDocument();
  });

  it('нет ключа: строка «не задан»', async () => {
    aiState = adminAi(noKey);
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('button', { name: /^API-ключ/ })).toHaveTextContent('не задан');
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

describe('админ: проверить, заменить, удалить', () => {
  it('«Проверить»: спиннер, затем зелёная галочка с сообщением', async () => {
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

  it('«Удалить» просит подтверждение, затем DELETE', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Удалить' }));
    expect(did('DELETE', '/api/admin/ai/key')).toBe(false);
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Удалить ключ?' })).getByRole('button', {
        name: 'Удалить',
      }),
    );

    await waitFor(() => expect(did('DELETE', '/api/admin/ai/key')).toBe(true));
  });

  it('без ключа «Проверить» и «Удалить» отключены с подсказкой', async () => {
    aiState = adminAi(noKey);
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    expect(ai.getByRole('button', { name: 'Удалить' })).toBeDisabled();
    expect(ai.getByRole('button', { name: 'Удалить' })).toHaveAttribute('title', 'Ключ не задан');
  });

  it('ключ из окружения: «Удалить» неактивна с подсказкой, окно ключа объясняет про SECRETS_KEY', async () => {
    aiState = adminAi({ keySource: 'env' });
    const user = renderAt('/admin');
    const ai = await block();

    const remove = ai.getByRole('button', { name: 'Удалить' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', expect.stringContaining('окружении'));
    await user.click(ai.getByRole('button', { name: /^API-ключ/ }));
    expect(
      await screen.findByText(/Чтобы заменить его в приложении, нужен SECRETS_KEY/),
    ).toBeInTheDocument();
    expect(screen.getByText('Ключ задан …1234 · из окружения')).toBeInTheDocument();
  });

  it('нет SECRETS_KEY: жёлтая плашка с командой, «Заменить» отключена, поле в окне ключа тоже', async () => {
    aiState = adminAi({ canStoreKey: false });
    const user = renderAt('/admin');
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
    await user.click(ai.getByRole('button', { name: /^API-ключ/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'API-ключ' }));
    expect(dialog.getByLabelText('Новый ключ')).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Сохранить ключ' })).toBeDisabled();
  });
});

describe('админ: использование', () => {
  it('«Сегодня 3 / 50», «За 30 дней 41», «Ошибок 2» в одной рамке', async () => {
    renderAt('/admin');
    const ai = await block();

    const usage = within(ai.getByRole('region', { name: 'Использование' }));
    expect(usage.getByText('Использование (последние 30 дней)')).toBeInTheDocument();
    expect(usage.getByText('Сегодня').nextSibling).toHaveTextContent('3 / 50');
    expect(usage.getByText('За 30 дней').nextSibling).toHaveTextContent('41');
    expect(usage.getByText('Ошибок').nextSibling).toHaveTextContent('2');
  });

  it('нулевое использование: «0 / 30»', async () => {
    aiState = adminAi({ dailyLimit: 30, usage: { today: 0, month: 0, errorsMonth: 0 } });
    renderAt('/admin');
    const ai = await block();

    expect(
      within(ai.getByRole('region', { name: 'Использование' })).getByText('0 / 30'),
    ).toBeInTheDocument();
  });

  it('списка групп в блоке ИИ больше нет', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.queryByRole('region', { name: 'Группы' })).toBeNull();
    expect(ai.queryByLabelText(/Лимит разборов в сутки/)).toBeNull();
  });
});

describe('«Настройки группы»: разбор чеков с помощью ИИ', () => {
  const row = async () => screen.findByRole('switch', { name: 'Разбор чеков с помощью ИИ' });
  beforeEach(() => {
    me = OWNER;
  });

  it('админ включил ИИ: переключатель доступен с пояснением про Google (Gemini)', async () => {
    renderAt('/group/receipts');

    const toggle = await row();
    expect(toggle).toBeEnabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Фото чека отправляется в Google \(Gemini\)/)).toBeInTheDocument();
  });

  it('переключение шлёт PUT /group/ai', async () => {
    const user = renderAt('/group/receipts');

    await user.click(await row());

    await waitFor(() => expect(sent('PUT', '/api/group/ai')).toEqual({ enabled: true }));
  });

  it('включено в группе: переключатель отмечен', async () => {
    status = { installationReady: true, groupEnabled: true, available: true };
    renderAt('/group/receipts');

    expect(await row()).toBeChecked();
  });

  it('ИИ не включён администратором или нет ключа: переключатель неактивен, подпись «Выключено администратором»', async () => {
    me = OWNER;
    status = { installationReady: false, groupEnabled: true, available: false };
    renderAt('/group/receipts');

    const toggle = await row();
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Выключено администратором')).toBeInTheDocument();
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
    renderAt('/group/receipts');
    const group = await aiGroup();

    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['Еда', 'Жильё']);
    expect(group.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 выбрано из 2')).toBeInTheDocument();
    expect(screen.getByText('Выключите для категорий, где это не нужно')).toBeInTheDocument();
  });

  it('выключение категории сохраняется с aiCategories (фото-категории не меняются)', async () => {
    const user = renderAt('/group/receipts');
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
    const user = renderAt('/group/receipts');
    const group = await aiGroup();
    expect(group.getByRole('button', { name: 'Жильё' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(group.getByRole('button', { name: 'Жильё' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/group/receipts')).toMatchObject({ aiCategories: ['Еда', 'Жильё'] }),
    );
  });

  it('переключение фото-категории шлёт и актуальный список aiCategories', async () => {
    const user = renderAt('/group/receipts');
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
    renderAt('/group/receipts');
    await screen.findByRole('group', { name: 'Категории с фото чека' });

    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
  });

  it('без категорий с фото блока выбора нет', async () => {
    receiptSettings = { enabled: true, categories: [], aiCategories: [] };
    renderAt('/group/receipts');
    await screen.findByRole('group', { name: 'Категории с фото чека' });

    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
  });
});

describe('«Настройки группы»: карточки фото и ИИ', () => {
  beforeEach(() => {
    me = OWNER;
    status = {
      installationReady: true,
      groupEnabled: true,
      available: true,
      dailyLimit: 30,
      usedToday: 1,
    } as typeof status;
    receiptSettings = { enabled: true, categories: ['Еда', 'Жильё'], aiCategories: ['Еда'] };
  });

  it('«Фото чеков»: подзаголовок, плашка про категории и «Категории — 2 выбрано из 3»', async () => {
    renderAt('/group/receipts');

    expect(await screen.findByText('К расходу можно прикреплять фото')).toBeInTheDocument();
    expect(
      screen.getByText('Участники смогут добавлять фото только для выбранных категорий'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 выбрано из 3')).toBeInTheDocument();
  });

  it('фото выключено: плашка, счётчик и чипы скрыты', async () => {
    receiptSettings = { enabled: false, categories: [] };
    renderAt('/group/receipts');
    await screen.findByText('К расходу можно прикреплять фото');

    expect(screen.queryByText(/Участники смогут добавлять фото/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Категории с фото чека' })).toBeNull();
  });

  it('ИИ: счётчик только по категориям с фото («1 выбрано из 2»), чипы только по ним', async () => {
    renderAt('/group/receipts');
    const chips = within(await screen.findByRole('group', { name: 'Категории с разбором ИИ' }));

    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['Еда', 'Жильё']);
    expect(screen.getByText('1 выбрано из 2')).toBeInTheDocument();
    expect(chips.queryByRole('button', { name: 'Прочее' })).toBeNull();
  });

  it('плашка лимита с числами из /ai/status; не администратору — слова про администратора', async () => {
    renderAt('/group/receipts');

    const note = (await screen.findByText(/Лимит: 30 разборов в сутки на группу/)).closest(
      '[role="note"]',
    )!;
    expect(note).toHaveTextContent('сегодня использовано 1.');
    expect(note).toHaveTextContent('Лимит задаёт администратор приложения.');
    expect(within(note as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('администратору вместо слов — ссылка «Администрирование»', async () => {
    me = { ...OWNER, isAdmin: true };
    renderAt('/group/receipts');

    const link = await screen.findByRole('link', { name: 'Администрирование' });
    expect(link).toHaveAttribute('href', '/admin');
    expect(screen.queryByText(/Лимит задаёт администратор приложения/)).toBeNull();
  });

  it('переключатель ИИ выключен: плашка и чипы скрыты', async () => {
    status = {
      installationReady: true,
      groupEnabled: false,
      available: false,
      dailyLimit: 30,
      usedToday: 1,
    } as typeof status;
    renderAt('/group/receipts');
    await screen.findByRole('switch', { name: 'Разбор чеков с помощью ИИ' });

    expect(screen.queryByText(/Лимит: 30/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
  });

  it('ИИ не включён в установке: неактивный переключатель и «Выключено администратором»', async () => {
    status = { installationReady: false, groupEnabled: true, available: false } as typeof status;
    renderAt('/group/receipts');

    expect(await screen.findByRole('switch', { name: 'Разбор чеков с помощью ИИ' })).toBeDisabled();
    expect(screen.getByText('Выключено администратором')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Категории с разбором ИИ' })).toBeNull();
  });

  it('чипы обоих рядов одного стиля: выбранные залиты, невыбранные в контуре', async () => {
    renderAt('/group/receipts');
    const ai = within(await screen.findByRole('group', { name: 'Категории с разбором ИИ' }));
    const photos = within(screen.getByRole('group', { name: 'Категории с фото чека' }));

    for (const chip of [
      ai.getByRole('button', { name: 'Еда' }),
      photos.getByRole('button', { name: 'Еда' }),
    ]) {
      expect(chip.className).toContain('bg-violet-600');
    }
    for (const chip of [
      ai.getByRole('button', { name: 'Жильё' }),
      photos.getByRole('button', { name: 'Прочее' }),
    ]) {
      expect(chip.className).toContain('border-zinc-300');
      expect(chip.className).not.toContain('bg-violet-600');
    }
  });

  it('в разделе «Чеки и ИИ» сначала фото, потом ИИ', async () => {
    renderAt('/group/receipts');
    const photo = (await screen.findByText('К расходу можно прикреплять фото')).closest('.py-4')!;
    const ai = screen.getByText(/Фото чека отправляется в Google/).closest('.py-4')!;

    expect(photo.nextElementSibling).toBe(ai);
  });
});

describe('«Язык названий»', () => {
  beforeEach(() => {
    me = OWNER;
    status = {
      installationReady: true,
      groupEnabled: true,
      available: true,
      languages: ['en', 'ru'],
    } as typeof status;
    receiptSettings = { enabled: true, categories: ['Еда'], aiCategories: ['Еда'] };
  });
  const chips = async () => within(await screen.findByRole('group', { name: 'Язык названий' }));

  it('два чипа «English» и «Русский» отражают разрешённые языки, с подсказкой', async () => {
    status = { ...status, languages: ['ru'] } as typeof status;
    renderAt('/group/receipts');
    const group = await chips();

    expect(group.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
    expect(group.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(/На каком языке ИИ записывает название магазина и позиций/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/остальные \(например, армянский\) переводятся на английский/),
    ).toBeInTheDocument();
  });

  it('снятие языка отправляет PUT с languages', async () => {
    const user = renderAt('/group/receipts');
    const group = await chips();

    await user.click(group.getByRole('button', { name: 'English' }));

    await waitFor(() => expect(sent('PUT', '/api/group/ai')).toEqual({ languages: ['ru'] }));
  });

  it('выбор языка добавляет его в список', async () => {
    status = { ...status, languages: ['ru'] } as typeof status;
    const user = renderAt('/group/receipts');
    const group = await chips();

    await user.click(group.getByRole('button', { name: 'English' }));

    await waitFor(() => expect(sent('PUT', '/api/group/ai')).toEqual({ languages: ['ru', 'en'] }));
  });

  it('последний выбранный язык снять нельзя', async () => {
    status = { ...status, languages: ['ru'] } as typeof status;
    const user = renderAt('/group/receipts');
    const group = await chips();

    await user.click(group.getByRole('button', { name: 'Русский' }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(did('PUT', '/api/group/ai')).toBe(false);
    expect(group.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('без поля languages в ответе считаются разрешёнными оба', async () => {
    status = { installationReady: true, groupEnabled: true, available: true } as typeof status;
    renderAt('/group/receipts');
    const group = await chips();

    expect(group.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('переключатель ИИ выключен: строки языка нет', async () => {
    status = { installationReady: true, groupEnabled: false, available: false } as typeof status;
    renderAt('/group/receipts');
    await screen.findByRole('switch', { name: 'Разбор чеков с помощью ИИ' });

    expect(screen.queryByRole('group', { name: 'Язык названий' })).toBeNull();
  });
});
