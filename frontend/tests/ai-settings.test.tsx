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
let status: { installationReady: boolean; groupEnabled: boolean; available: boolean };
let requests: { method: string; url: string; body?: Record<string, unknown> }[];
let respond: (method: string, url: string) => Response | undefined;

beforeEach(() => {
  me = ADMIN;
  aiState = adminAi();
  status = { installationReady: true, groupEnabled: false, available: false };
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
          categories: [],
          invitations: [],
        });
      }
      if (url === '/api/budgets') return ok([]);
      if (url === '/api/receipts/settings') return ok({ enabled: false, categories: [] });
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
  await screen.findByText(/Использовано/);
  return within(heading.closest('section')!);
};
const sent = (method: string, url: string) =>
  requests.find((r) => r.method === method && r.url === url)?.body;

describe('админ: блок «ИИ (Gemini)»', () => {
  it('показывает состояние, ключ (хвост и источник), модель, лимит и использование', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('switch', { name: 'Включить ИИ для установки' })).toBeChecked();
    expect(ai.getByText('Ключ задан …1234 (из приложения)')).toBeInTheDocument();
    expect(ai.getByLabelText('Модель')).toHaveValue('gemini-3.8-flash');
    expect(ai.getByLabelText('Разборов в сутки на группу')).toHaveValue('50');
    expect(ai.getByText(/сегодня 3, за 30 дней 41, ошибок за 30 дней 2/)).toBeInTheDocument();
  });

  it('поле ключа — пароль и никогда не заполняется полученным значением', async () => {
    renderAt('/admin');
    const ai = await block();

    const field = ai.getByLabelText('API-ключ Gemini');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveValue('');
  });

  it('тексты состояния ключа: из окружения, не задан', () => {
    expect(keyStatusText({ keyConfigured: true, keySource: 'env', keyHint: 'abcd' })).toBe(
      'Ключ задан …abcd (из окружения)',
    );
    expect(keyStatusText({ keyConfigured: false, keySource: 'none', keyHint: null })).toBe(
      'Ключ не задан',
    );
  });

  it('«Сохранить ключ» шлёт ключ и очищает поле', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.type(ai.getByLabelText('API-ключ Gemini'), 'SECRET-KEY');
    await user.click(ai.getByRole('button', { name: 'Сохранить ключ' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai/key')).toEqual({ apiKey: 'SECRET-KEY' }));
    await waitFor(() => expect(ai.getByLabelText('API-ключ Gemini')).toHaveValue(''));
  });

  it('«Сохранить ключ» недоступна, пока поле пустое', async () => {
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByRole('button', { name: 'Сохранить ключ' })).toBeDisabled();
  });

  it('«Проверить» показывает сообщение сервера', async () => {
    respond = (method, url) =>
      method === 'POST' && url === '/api/admin/ai/test'
        ? ok({ message: 'Ключ работает' })
        : undefined;
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Проверить' }));

    expect(await ai.findByText('Ключ работает')).toBeInTheDocument();
  });

  it('«Проверить»: ошибка показывается', async () => {
    respond = (method, url) =>
      method === 'POST' && url === '/api/admin/ai/test'
        ? json(
            { success: false, error: { code: 'AI_KEY_MISSING', message: 'Ключ не принят' } },
            400,
          )
        : undefined;
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Проверить' }));

    expect(await ai.findByRole('alert')).toHaveTextContent('Ключ не принят');
  });

  it('«Удалить ключ» вызывает DELETE; для ключа из окружения недоступна', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('button', { name: 'Удалить ключ' }));

    await waitFor(() => expect(sent('DELETE', '/api/admin/ai/key')).toBeUndefined());
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/admin/ai/key')).toBe(true);
  });

  it('ключ из окружения: удалить из приложения нельзя', async () => {
    aiState = adminAi({ keySource: 'env' });
    renderAt('/admin');
    const ai = await block();

    expect(ai.getByText('Ключ задан …1234 (из окружения)')).toBeInTheDocument();
    expect(ai.getByRole('button', { name: 'Удалить ключ' })).toBeDisabled();
  });

  it('нет SECRETS_KEY: пояснение, поле и «Сохранить ключ» отключены', async () => {
    aiState = adminAi({
      canStoreKey: false,
      keyConfigured: false,
      keySource: 'none',
      keyHint: null,
    });
    renderAt('/admin');
    const ai = await block();

    expect(
      ai.getByText('На сервере не задан SECRETS_KEY: ключ из приложения сохранить нельзя'),
    ).toBeInTheDocument();
    expect(ai.getByText('Ключ не задан')).toBeInTheDocument();
    expect(ai.getByLabelText('API-ключ Gemini')).toBeDisabled();
    expect(ai.getByRole('button', { name: 'Проверить' })).toBeDisabled();
  });

  it('переключатель включает и выключает ИИ для установки', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.click(ai.getByRole('switch', { name: 'Включить ИИ для установки' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai')).toEqual({ enabled: false }));
  });

  it('модель и общий лимит сохраняются своими кнопками', async () => {
    const user = renderAt('/admin');
    const ai = await block();
    expect(ai.queryByRole('button', { name: 'Сохранить' })).toBeNull();

    const model = ai.getByLabelText('Модель');
    await user.clear(model);
    await user.type(model, 'gemini-x');
    await user.click(ai.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(sent('PUT', '/api/admin/ai')).toEqual({ model: 'gemini-x' }));
  });

  it('общий лимит уходит числом', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    const limit = ai.getByLabelText('Разборов в сутки на группу');
    await user.clear(limit);
    await user.type(limit, '80');
    await user.click(ai.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PUT', '/api/admin/ai')).toEqual({ dailyLimit: 80 }));
  });

  it('группы: состояние, использование за сегодня и свой лимит (пусто = общий)', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    expect(ai.getByText(/Включён владельцем · сегодня разобрано: 2/)).toBeInTheDocument();
    expect(ai.getByText(/Выключен владельцем · сегодня разобрано: 0/)).toBeInTheDocument();
    expect(ai.getByLabelText('Лимит разборов в сутки: Семья')).toHaveValue('');
    expect(ai.getByLabelText('Лимит разборов в сутки: Соседи')).toHaveValue('10');

    await user.type(ai.getByLabelText('Лимит разборов в сутки: Семья'), '25');
    await user.click(ai.getAllByRole('button', { name: 'Сохранить' })[0]!);
    await waitFor(() => expect(sent('PUT', '/api/admin/groups/1/ai-limit')).toEqual({ limit: 25 }));
  });

  it('очистка своего лимита возвращает общий: limit = null', async () => {
    const user = renderAt('/admin');
    const ai = await block();

    await user.clear(ai.getByLabelText('Лимит разборов в сутки: Соседи'));
    await user.click(ai.getByRole('button', { name: 'Сохранить' }));

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
