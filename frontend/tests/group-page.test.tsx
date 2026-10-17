import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroupPage from '../src/features/group/pages/GroupPage.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);
const failure = (code: string, message: string, status: number) =>
  json({ success: false, error: { code, message } }, status);

const OWNER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
  role: 'owner',
  isAdmin: false,
};

const overview = () => ({
  group: {
    id: 1,
    name: 'Семья',
    reportingCurrency: 'AMD',
    timezone: 'Asia/Yerevan',
    disabled: false,
    memberEditMinutes: 1440,
  },
  currencies: ['AMD', 'USD'],
  members: [
    { userId: 1, username: 'misha', displayName: 'Миша', role: 'owner', fromEnv: true },
    { userId: 2, username: 'nastya', displayName: 'Настя', role: 'member', fromEnv: false },
    { userId: 3, username: 'petya', displayName: 'Петя', role: 'member', fromEnv: true },
  ],
  cards: [
    {
      id: 10,
      name: 'Миша',
      currency: 'AMD',
      archived: false,
      access: [{ userId: 2, level: 'view' }],
    },
    { id: 11, name: 'Общая', currency: 'AMD', archived: false, access: [] },
    { id: 12, name: 'Старая', currency: 'AMD', archived: true, access: [] },
  ],
  categories: [
    { id: 20, name: 'Еда', archived: false },
    { id: 21, name: 'Игры', archived: true },
  ],
  invitations: [
    {
      id: 30,
      kind: 'join',
      role: 'member',
      username: null,
      expiresAt: '2026-10-20T10:00:00.000Z',
      createdAt: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 31,
      kind: 'reset',
      role: null,
      username: 'nastya',
      expiresAt: '2026-10-20T10:00:00.000Z',
      createdAt: '2026-10-12T10:00:00.000Z',
    },
  ],
});

let me: Record<string, unknown>;
let requests: { method: string; url: string; body?: Record<string, unknown> }[];
let override: (method: string, url: string) => Response | undefined;
// Limits of the group as the server returns them for GET /api/budgets
let budgetsList: Record<string, unknown>[];
let receipts: { enabled: boolean; categories: string[] };
let templatesList: Record<string, unknown>[];
let apiKeys: Record<string, unknown>[];
let importLog: Record<string, unknown>[];

const budget = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  categoryId: null,
  category: null,
  limit: 20000,
  periodKind: 'month',
  periodDay: null,
  period: { from: '2026-10-01', to: '2026-10-31' },
  spent: 5000,
  remaining: 15000,
  percent: 25,
  level: 'ok',
  currency: 'AMD',
  ...overrides,
});

beforeEach(() => {
  me = OWNER;
  requests = [];
  override = () => undefined;
  budgetsList = [];
  receipts = { enabled: false, categories: [] };
  templatesList = [];
  apiKeys = [];
  importLog = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/auth/me') return ok({ user: me });
      const forced = override(method, url);
      if (forced) return forced;
      if (url === '/api/group' && method === 'GET') return ok(overview());
      if (url === '/api/group/api-keys' && method === 'GET') return ok(apiKeys);
      if (url === '/api/group/api-keys' && method === 'POST')
        return ok({ id: 'k9', key: 'etk_FULLSECRETKEY123' }, 201);
      if (url.startsWith('/api/group/api-keys/') && method === 'DELETE') return ok({});
      if (url.startsWith('/api/group/import-log')) {
        const source = new URL(url, 'http://x').searchParams.get('source');
        return ok(importLog.filter((entry) => !source || entry.source === source));
      }
      if (url === '/api/templates' && method === 'GET') return ok(templatesList);
      if (url === '/api/cards') return ok([{ name: 'Миша', currency: 'AMD' }]);
      if (url === '/api/categories') return ok(['Еда']);
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD'], rates: [] });
      if (url === '/api/name-suggestions') return ok([]);
      if (url === '/api/budgets') return ok(budgetsList);
      if (url === '/api/receipts/settings') return ok(receipts);
      if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
      if (url === '/api/group/budgets' && method === 'POST') return ok({ id: 'b9' }, 201);
      if (url === '/api/group/invitations' && method === 'POST')
        return ok({ token: 'TOKEN-1', expiresAt: '2026-10-20T10:00:00.000Z' }, 201);
      if (url.endsWith('/reset-password'))
        return ok({ token: 'RESET-1', expiresAt: '2026-10-20T10:00:00.000Z' }, 201);
      if (url === '/api/group/cards' && method === 'POST') return ok({ id: 99 }, 201);
      if (url === '/api/group/receipts' && method === 'PUT') return ok({});
      return ok({});
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

// The group is sections now: a test opens the section it checks
let groupPath = '/group/general';

async function renderGroup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[groupPath]}>
        <Routes>
          <Route path="group/*" element={<GroupPage />} />
          <Route path="/" element={<p>Главная</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const sent = (method: string, url: string) =>
  requests.find((r) => r.method === method && r.url === url)?.body;
const section = (name: string | RegExp) => screen.getByRole('region', { name });
const card = (name: string | RegExp) => within(section(name));

/** Opens the «⋯» menu of a row and presses an item. */
async function choose(person: Awaited<ReturnType<typeof renderGroup>>, row: string, item: string) {
  await person.click(screen.getByRole('button', { name: `Действия: ${row}` }));
  await person.click(screen.getByRole('menuitem', { name: item }));
}
const dialog = () => within(screen.getByRole('dialog'));
const confirmDialog = () =>
  within(screen.getByRole('dialog', { name: 'Сменить валюту отчётности?' }));

describe('страница «Группа»', () => {
  it('на компьютере /group открывает «Основные»; слева меню разделов с названием группы, справа раздел', async () => {
    groupPath = '/group';
    await renderGroup();

    expect(await screen.findByRole('heading', { name: 'Основные', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Группа «Семья»', level: 2 })).toBeInTheDocument();
    const menu = within(screen.getByRole('navigation', { name: 'Разделы группы' }));
    expect(menu.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/group/general',
      '/group/members',
      '/group/cards',
      '/group/categories',
      '/group/templates',
      '/group/receipts',
    ]);
    expect(menu.getByRole('link', { name: /Основные/ })).toHaveAttribute('aria-current', 'page');
    const automation = within(screen.getByRole('navigation', { name: 'Автоматизация' }));
    expect(automation.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/group/integrations',
      '/group/broadcast',
    ]);
    // Only the badge stays at the right of a menu row: the titles are not cut
    expect(menu.getByRole('link', { name: /Участники и приглашения/ })).not.toHaveTextContent('3');
  });

  it('меню слева переключает раздел', async () => {
    groupPath = '/group/general';
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });

    await person.click(
      within(screen.getByRole('navigation', { name: 'Разделы группы' })).getByRole('link', {
        name: /Карты/,
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Карты', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Карты/ })).toBeInTheDocument();
  });

  it('неизвестный раздел ведёт на /group (на компьютере — в «Основные»)', async () => {
    groupPath = '/group/xyz';
    await renderGroup();

    expect(await screen.findByRole('heading', { name: 'Основные', level: 2 })).toBeInTheDocument();
  });

  it('подсказок две: у карточки категорий и (в окне) у правки трат; у остальных карточек их нет', async () => {
    groupPath = '/group/categories';
    await renderGroup();

    await screen.findByRole('region', { name: /^Категории и лимиты/ });
    expect(card(/^Категории и лимиты/).getAllByRole('button', { name: 'Подсказка' })).toHaveLength(
      1,
    );
  });

  it('не владельцу не показывает ничего и не запрашивает группу', async () => {
    me = { ...OWNER, role: 'member' };
    await renderGroup();

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/group')).toBe(false);
  });
});

describe('аватар', () => {
  it('цвет аватара стабилен для одного имени и зависит от имени', async () => {
    const { Avatar } = await import('../src/shared/ui/Avatar.tsx');
    const { render: renderOnly } = await import('@testing-library/react');
    const color = (name: string) => {
      const { container, unmount } = renderOnly(<Avatar name={name} />);
      const value = container.firstElementChild!.className;
      unmount();
      return value;
    };
    expect(color('Настя')).toBe(color('Настя'));
    expect(
      new Set(['Миша', 'Настя', 'Петя', 'Анна', 'Олег', 'Ирина'].map(color)).size,
    ).toBeGreaterThan(1);
  });
});

describe('меню «⋯»', () => {
  beforeEach(() => {
    groupPath = '/group/cards';
  });
  it('кнопка с aria-haspopup, открывается кликом, пункты — menuitem', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });
    const button = screen.getByRole('button', { name: 'Действия: Общая' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await person.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Переименовать', 'Сменить валюту', 'Цифры карты', 'В архив']);
    // The focus moves into the menu
    expect(screen.getByRole('menuitem', { name: 'Переименовать' })).toHaveFocus();
  });

  it('Escape закрывает меню и возвращает фокус на кнопку', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });
    const button = screen.getByRole('button', { name: 'Действия: Общая' });
    await person.click(button);

    await person.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('клик вне меню закрывает его; стрелки переходят по пунктам', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });
    await person.click(screen.getByRole('button', { name: 'Действия: Общая' }));

    await person.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Сменить валюту' })).toHaveFocus();
    await person.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Переименовать' })).toHaveFocus();

    await person.click(screen.getByRole('heading', { name: 'Карты', level: 2 }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('настройки группы', () => {
  beforeEach(() => {
    groupPath = '/group/general';
  });
  const settings = () => card('Основные настройки');

  it('название — строка со значением; окно открывается по нажатию, PUT /group', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });
    const row = settings().getByRole('button', { name: /^Название группы/ });
    expect(row).toHaveTextContent('Семья');
    expect(row).toHaveTextContent('Его видят все участники');
    expect(settings().queryByLabelText('Новое название группы')).toBeNull();

    await person.click(row);
    const field = settings().getByLabelText('Новое название группы');
    await person.clear(field);
    await person.type(field, 'Наш дом');
    await person.click(settings().getByRole('button', { name: 'Сохранить' }));

    expect(sent('PATCH', '/api/group')).toEqual({ name: 'Наш дом' });
    await waitFor(() => expect(settings().queryByLabelText('Новое название группы')).toBeNull());
  });

  it('валюта отчётности: один селектор; смена — через подтверждение, PUT и сообщение о пересчёте', async () => {
    override = (method, url) =>
      method === 'PUT' && url === '/api/group/reporting-currency'
        ? ok({ recalculated: 3 })
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });
    const row = settings().getByRole('button', { name: /^Валюта отчётности/ });
    expect(row).toHaveTextContent('AMD');
    await person.click(row);
    const select = settings().getByRole('combobox', { name: 'Валюта отчётности' });
    expect(select).toHaveValue('AMD');

    await person.selectOptions(select, 'USD');

    const confirm = confirmDialog();
    expect(screen.getByRole('dialog', { name: 'Сменить валюту отчётности?' })).toHaveTextContent(
      'Все суммы пересчитаются в USD',
    );
    expect(screen.getByRole('dialog', { name: 'Сменить валюту отчётности?' })).toHaveTextContent(
      'Это нельзя отменить',
    );
    expect(sent('PUT', '/api/group/reporting-currency')).toBeUndefined();
    await person.click(confirm.getByRole('button', { name: 'Сменить' }));

    expect(sent('PUT', '/api/group/reporting-currency')).toEqual({ currency: 'USD' });
    expect(await settings().findByText('Пересчитано трат: 3')).toBeInTheDocument();
  });

  it('отмена подтверждения ничего не отправляет и возвращает прежнюю валюту', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });

    await person.click(settings().getByRole('button', { name: /^Валюта отчётности/ }));
    await person.selectOptions(
      settings().getByRole('combobox', { name: 'Валюта отчётности' }),
      'USD',
    );
    await person.click(confirmDialog().getByRole('button', { name: 'Отмена' }));

    expect(sent('PUT', '/api/group/reporting-currency')).toBeUndefined();
    expect(settings().getByRole('combobox', { name: 'Валюта отчётности' })).toHaveValue('AMD');
  });

  it('ошибка смены валюты показывается, подтверждение закрывается', async () => {
    override = (method, url) =>
      method === 'PUT' && url === '/api/group/reporting-currency'
        ? failure('RATE_UNAVAILABLE', 'Курс валюты недоступен', 422)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });

    await person.click(settings().getByRole('button', { name: /^Валюта отчётности/ }));
    await person.selectOptions(
      settings().getByRole('combobox', { name: 'Валюта отчётности' }),
      'USD',
    );
    await person.click(confirmDialog().getByRole('button', { name: 'Сменить' }));

    expect(await settings().findByRole('alert')).toHaveTextContent('Курс валюты недоступен');
    expect(screen.queryByRole('dialog', { name: 'Сменить валюту отчётности?' })).toBeNull();
  });

  it.each([
    ['Выключено', 0],
    ['15 минут', 15],
    ['1 час', 60],
    ['24 часа', 1440],
    ['Неделя', 10080],
  ])('окно правки «%s» сохраняется сразу: PUT с minutes %i', async (label, minutes) => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });
    await person.click(settings().getByRole('button', { name: /^Правка своих трат участниками/ }));
    expect(
      within(screen.getByRole('dialog', { name: 'Правка своих трат участниками' })).getByRole(
        'button',
        { name: 'Подсказка' },
      ),
    ).toBeInTheDocument();
    const select = settings().getByLabelText('Сколько времени участник может править свои траты');
    if (minutes === 1440) await person.selectOptions(select, 'Неделя');

    await person.selectOptions(select, label);

    await waitFor(() =>
      expect(requests.filter((r) => r.url === '/api/group/member-edit').at(-1)?.body).toEqual({
        minutes,
      }),
    );
  });

  it('ошибка окна правки показывается', async () => {
    override = (method, url) =>
      method === 'PUT' && url === '/api/group/member-edit'
        ? failure('INVALID_MINUTES', 'Недопустимое значение', 422)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Основные', level: 2 });

    await person.click(settings().getByRole('button', { name: /^Правка своих трат участниками/ }));
    await person.selectOptions(
      settings().getByLabelText('Сколько времени участник может править свои траты'),
      'Выключено',
    );

    expect(await settings().findByRole('alert')).toHaveTextContent('Недопустимое значение');
  });
});

describe('чеки и ИИ', () => {
  const settings = () => card('Чеки и ИИ');
  beforeEach(() => {
    groupPath = '/group/receipts';
  });

  it('фото чеков: переключатель role=switch; чипы категорий только при включении, без архивных', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Чеки и ИИ', level: 2 });
    const toggle = await settings().findByRole('switch', { name: 'Разрешить фото чеков' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(settings().queryByRole('group', { name: 'Категории с фото чека' })).toBeNull();

    await person.click(toggle);

    await waitFor(() =>
      expect(requests.filter((r) => r.url === '/api/group/receipts').at(-1)?.body).toEqual({
        enabled: true,
        categories: [],
      }),
    );
  });

  it('фото чеков включены: чипы, выбор сохраняется сразу', async () => {
    receipts = { enabled: true, categories: ['Еда'] };
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Чеки и ИИ', level: 2 });
    const group = await settings().findByRole('group', { name: 'Категории с фото чека' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Еда']);
    expect(settings().getByRole('switch', { name: 'Разрешить фото чеков' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await person.click(within(group).getByRole('button', { name: 'Еда' }));

    await waitFor(() =>
      expect(requests.filter((r) => r.url === '/api/group/receipts').at(-1)?.body).toEqual({
        enabled: true,
        categories: [],
      }),
    );
  });
});

describe('участники', () => {
  beforeEach(() => {
    groupPath = '/group/members';
  });
  const members = () => card(/^Участники/);

  it('строки: аватар с инициалом, имя, «@логин · роль»', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    const row = members().getByText('Настя').closest('li')!;
    expect(row).toHaveTextContent('@nastya · Участник');
    expect(row).toHaveTextContent('Н');
    expect(members().getByText('Миша').closest('li')).toHaveTextContent('@misha · Владелец');
  });

  it('у себя меню нет; у участника из .env нет «Исключить из группы»', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });
    expect(members().queryByRole('button', { name: 'Действия: Миша' })).toBeNull();

    await person.click(members().getByRole('button', { name: 'Действия: Петя' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Изменить роль',
      'Доступ к картам',
      'Ссылка для сброса пароля',
    ]);
  });

  it('у обычного участника все четыре пункта', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await person.click(members().getByRole('button', { name: 'Действия: Настя' }));

    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Изменить роль',
      'Доступ к картам',
      'Ссылка для сброса пароля',
      'Исключить из группы',
    ]);
  });

  it('смена роли: подтверждение, затем PUT {role}', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await choose(person, 'Настя', 'Изменить роль');
    expect(screen.getByRole('dialog')).toHaveTextContent('Сделать Настя владельцем?');
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    await person.click(dialog().getByRole('button', { name: 'Сделать владельцем' }));

    expect(sent('PUT', '/api/group/members/nastya/role')).toEqual({ role: 'owner' });
  });

  it('владельца можно сделать участником; у владельца нет «Доступ к картам»', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({
            ...overview(),
            members: overview().members.map((m) =>
              m.username === 'nastya' ? { ...m, role: 'owner' } : m,
            ),
          })
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await person.click(members().getByRole('button', { name: 'Действия: Настя' }));
    expect(screen.queryByRole('menuitem', { name: 'Доступ к картам' })).toBeNull();
    await person.click(screen.getByRole('menuitem', { name: 'Изменить роль' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('не сможет править траты');
    await person.click(dialog().getByRole('button', { name: 'Сделать участником' }));

    expect(sent('PUT', '/api/group/members/nastya/role')).toEqual({ role: 'member' });
  });

  it('ошибка LAST_EDITOR показывается', async () => {
    override = (method, url) =>
      method === 'PUT' && url.endsWith('/role')
        ? failure('LAST_EDITOR', 'Нельзя убрать последнего владельца', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await choose(person, 'Настя', 'Изменить роль');
    await person.click(dialog().getByRole('button', { name: 'Сделать владельцем' }));

    expect(await members().findByRole('alert')).toHaveTextContent('последнего владельца');
  });

  it('ссылка для сброса пароля показывается под строкой', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await choose(person, 'Настя', 'Ссылка для сброса пароля');

    expect(await members().findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/RESET-1`,
    );
  });

  it('исключение — с подтверждением', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await choose(person, 'Настя', 'Исключить из группы');
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await person.click(dialog().getByRole('button', { name: 'Исключить' }));

    expect(
      requests.some((r) => r.method === 'DELETE' && r.url === '/api/group/members/nastya'),
    ).toBe(true);
  });

  it('доступ к картам: полная карта доступа, «нет доступа» опускается, владельцы не перечислены', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await choose(person, 'Петя', 'Доступ к картам');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Доступ к картам: Петя');
    await person.selectOptions(dialog().getByLabelText('Доступ к карте «Миша»: Петя'), 'edit');

    expect(sent('PUT', '/api/group/cards/10/access')).toEqual({
      access: { nastya: 'view', petya: 'edit' },
    });
  });

  it('доступ: выбор «нет доступа» убирает участника из карты', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await choose(person, 'Настя', 'Доступ к картам');
    await person.selectOptions(dialog().getByLabelText('Доступ к карте «Миша»: Настя'), 'none');

    expect(sent('PUT', '/api/group/cards/10/access')).toEqual({ access: {} });
  });
});

describe('приглашения', () => {
  beforeEach(() => {
    groupPath = '/group/members';
  });
  const members = () => card(/^Участники/);

  it('«+ Пригласить» открывает окно: роль, создание, ссылка с токеном и «Скопировать»', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    await person.click(members().getByRole('button', { name: 'Пригласить' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Пригласить в группу');
    await person.selectOptions(dialog().getByLabelText('Роль приглашённого'), 'owner');
    expect(screen.getByRole('dialog')).toHaveTextContent('Второй владелец получает те же права');
    await person.click(dialog().getByRole('button', { name: 'Создать приглашение' }));

    expect(await dialog().findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/TOKEN-1`,
    );
    expect(sent('POST', '/api/group/invitations')).toEqual({ role: 'owner' });
    expect(dialog().getByRole('button', { name: 'Скопировать' })).toBeInTheDocument();
    expect(dialog().getByText(/действует до/)).toBeInTheDocument();
    await person.click(dialog().getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ожидающие приглашения — свёрнутый блок со счётчиком; отзыв', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    const pending = members().getByText('Ожидающие приглашения (2)').closest('details')!;
    expect(pending).not.toHaveAttribute('open');
    await person.click(members().getByText('Ожидающие приглашения (2)'));
    expect(within(pending).getByText('Приглашение · Участник')).toBeInTheDocument();
    expect(within(pending).getByText('Сброс пароля · nastya')).toBeInTheDocument();

    await person.click(
      within(pending).getByRole('button', { name: 'Отозвать: Приглашение · Участник' }),
    );

    expect(
      requests.some((r) => r.method === 'DELETE' && r.url === '/api/group/invitations/30'),
    ).toBe(true);
  });

  it('без ожидающих приглашений блока нет', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group' ? ok({ ...overview(), invitations: [] }) : undefined;
    await renderGroup();
    await screen.findByRole('heading', { name: /^Участники/ });

    expect(members().queryByText(/Ожидающие приглашения/)).toBeNull();
  });
});

describe('карты', () => {
  beforeEach(() => {
    groupPath = '/group/cards';
  });
  const cards = () => card(/^Карты/);

  it('строки: название и валюта; архив свёрнут, постоянной формы внизу нет', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    expect(cards().getByText('Общая').closest('li')).toHaveTextContent('AMD');
    expect(cards().getByText('Архив карт (1)').closest('details')).not.toHaveAttribute('open');
    expect(cards().queryByLabelText('Новая карта')).toBeNull();
  });

  it('«+ Добавить» → окно: название, валюта по умолчанию — валюта отчётности, POST с валютой', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await person.click(cards().getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Новая карта');
    expect(dialog().getByLabelText('Валюта новой карты')).toHaveValue('AMD');
    await person.selectOptions(dialog().getByLabelText('Валюта новой карты'), 'USD');
    await person.type(dialog().getByLabelText('Название карты'), 'Отпуск');
    await person.click(dialog().getByRole('button', { name: 'Добавить' }));

    await waitFor(() =>
      expect(sent('POST', '/api/group/cards')).toEqual({ name: 'Отпуск', currency: 'USD' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('если разрешена одна валюта, выбора нет и уходит только название', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({ ...overview(), currencies: ['AMD'] })
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await person.click(cards().getByRole('button', { name: 'Добавить' }));
    expect(dialog().queryByLabelText('Валюта новой карты')).toBeNull();
    await person.type(dialog().getByLabelText('Название карты'), 'Отпуск');
    await person.click(dialog().getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(sent('POST', '/api/group/cards')).toEqual({ name: 'Отпуск' }));
    // No «Сменить валюту» in the menu either
    await person.click(cards().getByRole('button', { name: 'Действия: Общая' }));
    expect(screen.queryByRole('menuitem', { name: 'Сменить валюту' })).toBeNull();
  });

  it('ошибка NAME_TAKEN остаётся в окне, введённое название сохраняется', async () => {
    override = (method, url) =>
      method === 'POST' && url === '/api/group/cards'
        ? failure('NAME_TAKEN', 'Карта с таким названием уже есть', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await person.click(cards().getByRole('button', { name: 'Добавить' }));
    await person.type(dialog().getByLabelText('Название карты'), 'Общая');
    await person.click(dialog().getByRole('button', { name: 'Добавить' }));

    expect(await dialog().findByRole('alert')).toHaveTextContent(
      'Карта с таким названием уже есть',
    );
    expect(dialog().getByLabelText('Название карты')).toHaveValue('Общая');
  });

  it('переименование через меню: PATCH с названием', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await choose(person, 'Общая', 'Переименовать');
    const field = dialog().getByLabelText('Новое название: Общая');
    await person.clear(field);
    await person.type(field, 'Семейная');
    await person.click(dialog().getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/api/group/cards/11')).toEqual({ name: 'Семейная' }));
  });

  it('смена валюты: PATCH только с валютой; CARD_HAS_EXPENSES показывается в окне', async () => {
    override = (method, url) =>
      method === 'PATCH' && url === '/api/group/cards/11'
        ? failure('CARD_HAS_EXPENSES', 'По карте уже есть траты: валюту не изменить', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await choose(person, 'Общая', 'Сменить валюту');
    await person.selectOptions(dialog().getByLabelText('Валюта: Общая'), 'USD');
    await person.click(dialog().getByRole('button', { name: 'Сохранить' }));

    expect(sent('PATCH', '/api/group/cards/11')).toEqual({ currency: 'USD' });
    expect(await dialog().findByRole('alert')).toHaveTextContent('По карте уже есть траты');
  });

  it('в архив и возврат из архива', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await choose(person, 'Общая', 'В архив');
    expect(sent('PATCH', '/api/group/cards/11')).toEqual({ archived: true });

    await person.click(cards().getByText('Архив карт (1)'));
    await person.click(cards().getByRole('button', { name: 'Вернуть: Старая' }));
    expect(sent('PATCH', '/api/group/cards/12')).toEqual({ archived: false });
  });
});

describe('категории и лимиты', () => {
  beforeEach(() => {
    groupPath = '/group/categories';
  });
  const categories = () => card(/^Категории и лимиты/);
  const cat = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    archived: false,
    ...extra,
  });
  const withCategories = (list: unknown[]) =>
    (override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({ ...overview(), categories: list })
        : undefined);

  it('«+ Добавить» → окно новой категории, POST', async () => {
    const person = await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });

    await person.click(categories().getByRole('button', { name: 'Добавить' }));
    await person.type(dialog().getByLabelText('Название категории'), 'Одежда');
    await person.click(dialog().getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(sent('POST', '/api/group/categories')).toEqual({ name: 'Одежда' }));
  });

  it('меню строки: Переименовать, Лимит…, В архив (Слить — только при нескольких категориях)', async () => {
    const person = await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });

    await person.click(await categories().findByRole('button', { name: 'Действия: Еда' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Переименовать',
      'Лимит…',
      'В архив',
    ]);
  });

  it('переименование, архив, возврат, слияние', async () => {
    withCategories([cat(20, 'Еда'), cat(22, 'Продукты'), cat(21, 'Игры', { archived: true })]);
    const person = await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });

    await choose(person, 'Еда', 'Переименовать');
    const field = dialog().getByLabelText('Новое название: Еда');
    await person.clear(field);
    await person.type(field, 'Питание');
    await person.click(dialog().getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(sent('PATCH', '/api/group/categories/20')).toEqual({ name: 'Питание' }),
    );

    await choose(person, 'Продукты', 'В архив');
    await waitFor(() =>
      expect(
        requests.some((r) => r.url === '/api/group/categories/22' && r.body?.archived === true),
      ).toBe(true),
    );

    await person.click(categories().getByText('Архив категорий (1)'));
    await person.click(categories().getByRole('button', { name: 'Вернуть: Игры' }));
    expect(sent('PATCH', '/api/group/categories/21')).toEqual({ archived: false });

    await choose(person, 'Еда', 'Слить с другой');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Все траты категории «Еда» перейдут в «Продукты»',
    );
    await person.click(dialog().getByRole('button', { name: 'Объединить' }));
    await waitFor(() =>
      expect(
        requests.some((r) => r.url === '/api/group/categories/20' && r.body?.mergeInto === 22),
      ).toBe(true),
    );
  });

  it('закреплённая строка «Общий бюджет»: «не задан» или лимит; карандаш открывает диалог лимита', async () => {
    const person = await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });
    await categories().findByRole('button', { name: 'Лимит: Все категории' });
    expect(categories().getByText('не задан')).toBeInTheDocument();

    await person.click(categories().getByRole('button', { name: 'Лимит: Все категории' }));

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Лимит: Все категории');
  });

  it('у категории без лимита «—», с лимитом — сумма', async () => {
    budgetsList = [budget({ id: 'b2', categoryId: 20, category: 'Еда', limit: 80000 })];
    await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });

    expect(await categories().findByText('80 000 AMD')).toBeInTheDocument();
    withCategories([cat(20, 'Еда'), cat(23, 'Кафе')]);
  });

  it('период один раз над списком, если у всех лимитов он одинаковый; в строках его нет', async () => {
    budgetsList = [
      budget({ periodKind: 'month_from_day', periodDay: 5 }),
      budget({
        id: 'b2',
        categoryId: 20,
        category: 'Еда',
        limit: 80000,
        periodKind: 'month_from_day',
        periodDay: 5,
      }),
    ];
    await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });

    expect(await categories().findByText('Период лимитов: месяц с 5-го')).toBeInTheDocument();
    expect(categories().getByText('80 000 AMD').closest('li')).not.toHaveTextContent(
      'месяц с 5-го',
    );
  });

  it('если периоды разные, общего нет, и строки показывают свой период', async () => {
    budgetsList = [
      budget(),
      budget({ id: 'b2', categoryId: 20, category: 'Еда', limit: 80000, periodKind: 'week' }),
    ];
    await renderGroup();
    await screen.findByRole('region', { name: /^Категории и лимиты/ });

    expect(await categories().findByText('80 000 AMD')).toBeInTheDocument();
    expect(categories().queryByText(/Период лимитов/)).toBeNull();
    expect(categories().getByText('80 000 AMD').closest('li')).toHaveTextContent('неделя');
  });
});

describe('диалог лимита', () => {
  beforeEach(() => {
    groupPath = '/group/categories';
  });
  const dlg = () => within(screen.getByRole('dialog'));
  const sentAll = (method: string, url: string) =>
    requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

  async function openLimit(person: Awaited<ReturnType<typeof renderGroup>>, name: string) {
    await screen.findByRole('region', { name: /^Категории и лимиты/ });
    if (name === 'Все категории') {
      await person.click(
        await card(/^Категории и лимиты/).findByRole('button', { name: 'Лимит: Все категории' }),
      );
    } else {
      await choose(person, name, 'Лимит…');
    }
    return dlg();
  }

  it('диалог: период сегментами «Месяц / Неделя», без нативного select; число месяца только для «Месяц»', async () => {
    const person = await renderGroup();
    const box = await openLimit(person, 'Еда');

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Лимит: Еда');
    expect(box.queryByRole('combobox')).toBeNull();
    expect(box.getByRole('radio', { name: 'Месяц' })).toBeChecked();
    expect(box.getByLabelText('Месяц начинается')).toHaveValue('1');
    expect(box.getByText('1 — календарный месяц')).toBeInTheDocument();

    await person.click(box.getByRole('radio', { name: 'Неделя' }));
    expect(box.queryByLabelText('Месяц начинается')).toBeNull();
    expect(box.getByText('с понедельника по воскресенье')).toBeInTheDocument();
  });

  it.each([
    ['месяц, число 1 → month', 'Месяц', '1', { limit: 3000, periodKind: 'month' }],
    [
      'месяц, число 10 → month_from_day',
      'Месяц',
      '10',
      { limit: 3000, periodKind: 'month_from_day', periodDay: 10 },
    ],
    ['неделя → week', 'Неделя', '', { limit: 3000, periodKind: 'week' }],
  ])('новый лимит: %s', async (_name, mode, day, expected) => {
    const person = await renderGroup();
    const box = await openLimit(person, 'Еда');

    await person.type(box.getByLabelText('Сумма'), '3000');
    await person.click(box.getByRole('radio', { name: mode as string }));
    if (mode === 'Месяц') {
      await person.clear(box.getByLabelText('Месяц начинается'));
      await person.type(box.getByLabelText('Месяц начинается'), day as string);
    }
    await person.click(box.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sentAll('POST', '/api/group/budgets')).toHaveLength(1));
    expect(sentAll('POST', '/api/group/budgets')[0]).toEqual({ categoryId: 20, ...expected });
  });

  it('общий лимит: categoryId null', async () => {
    const person = await renderGroup();
    const box = await openLimit(person, 'Все категории');

    await person.type(box.getByLabelText('Сумма'), '1500,5');
    await person.click(box.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sentAll('POST', '/api/group/budgets')).toHaveLength(1));
    expect(sentAll('POST', '/api/group/budgets')[0]).toEqual({
      categoryId: null,
      limit: 1500.5,
      periodKind: 'month',
    });
  });

  it('существующий лимит: поля заполнены, «Сохранить» шлёт PUT, «Убрать лимит» — DELETE', async () => {
    budgetsList = [
      budget({
        id: 'b2',
        categoryId: 20,
        category: 'Еда',
        limit: 80000,
        periodKind: 'month_from_day',
        periodDay: 5,
      }),
    ];
    const person = await renderGroup();
    const box = await openLimit(person, 'Еда');

    expect(box.getByLabelText('Сумма')).toHaveValue('80 000');
    expect(box.getByLabelText('Месяц начинается')).toHaveValue('5');
    await person.clear(box.getByLabelText('Сумма'));
    await person.type(box.getByLabelText('Сумма'), '90000');
    await person.click(box.getByRole('radio', { name: 'Неделя' }));
    await person.click(box.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(sentAll('PUT', '/api/group/budgets/b2')).toHaveLength(1));
    expect(sentAll('PUT', '/api/group/budgets/b2')[0]).toEqual({
      limit: 90000,
      periodKind: 'week',
    });

    const again = await openLimit(person, 'Еда');
    await person.click(again.getByRole('button', { name: 'Убрать лимит' }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/group/budgets/b2')).toBe(
        true,
      ),
    );
  });

  it('«Убрать лимит» только у существующего; проверка суммы и числа; ошибка 409 в окне', async () => {
    override = (method, url) =>
      method === 'POST' && url === '/api/group/budgets'
        ? failure('BUDGET_EXISTS', 'Лимит на эту категорию уже есть', 409)
        : undefined;
    const person = await renderGroup();
    const box = await openLimit(person, 'Еда');
    expect(box.queryByRole('button', { name: 'Убрать лимит' })).toBeNull();

    await person.click(box.getByRole('button', { name: 'Сохранить' }));
    expect(box.getByText('Введите сумму больше нуля')).toBeInTheDocument();
    await person.type(box.getByLabelText('Сумма'), '100');
    await person.clear(box.getByLabelText('Месяц начинается'));
    await person.type(box.getByLabelText('Месяц начинается'), '30');
    await person.click(box.getByRole('button', { name: 'Сохранить' }));
    expect(box.getByText('Число месяца — от 1 до 28')).toBeInTheDocument();
    expect(sentAll('POST', '/api/group/budgets')).toHaveLength(0);

    await person.clear(box.getByLabelText('Месяц начинается'));
    await person.type(box.getByLabelText('Месяц начинается'), '1');
    await person.click(box.getByRole('button', { name: 'Сохранить' }));
    expect(await box.findByRole('alert')).toHaveTextContent('Лимит на эту категорию уже есть');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('после сохранения диалог закрывается и лимиты запрашиваются заново', async () => {
    const person = await renderGroup();
    const box = await openLimit(person, 'Еда');
    const before = requests.filter((r) => r.url === '/api/budgets').length;

    budgetsList = [budget({ id: 'b9', categoryId: 20, category: 'Еда', limit: 3000 })];
    await person.type(box.getByLabelText('Сумма'), '3000');
    await person.click(box.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(requests.filter((r) => r.url === '/api/budgets').length).toBeGreaterThan(before),
    );
    expect(await card(/^Категории и лимиты/).findByText('3 000 AMD')).toBeInTheDocument();
  });
});

describe('карточка «Шаблоны группы»', () => {
  beforeEach(() => {
    groupPath = '/group/templates';
  });
  const groupTemplate = (overrides: Record<string, unknown> = {}) => ({
    id: 'g1',
    scope: 'group',
    pending: false,
    sharedStatus: null,
    name: 'Аренда',
    emoji: null,
    category: 'Еда',
    card: null,
    effectiveCard: 'Миша',
    expenseName: 'Аренда',
    amount: 5000,
    currency: 'AMD',
    author: 'Миша',
    updatedBy: null,
    updatedAt: null,
    editable: true,
    mine: true,
    hidden: false,
    unavailable: false,
    ...overrides,
  });

  it('пустое состояние и пояснение', async () => {
    await renderGroup();

    const templates = within(await screen.findByRole('region', { name: 'Шаблоны группы' }));
    expect(
      templates.getByText(
        'Быстрые траты для всех участников. Каждый может скрыть их у себя в личных настройках',
      ),
    ).toBeInTheDocument();
    expect(
      await templates.findByText(
        'Групповых шаблонов пока нет. Создайте свой или включите предложение участника',
      ),
    ).toBeInTheDocument();
  });

  it('предложения сверху с автором, счётчик в заголовке; «Включить» и «Отклонить» зовут нужные запросы', async () => {
    templatesList = [
      groupTemplate({ id: 'p1', name: 'Кофе', pending: true, mine: false, author: 'Настя' }),
      groupTemplate({ id: 'p2', name: 'Метро', pending: true, mine: false, author: 'Петя' }),
      groupTemplate(),
    ];
    const person = await renderGroup();

    const heading = await screen.findByRole('region', { name: 'Шаблоны группы · 2 новых' });
    const templates = within(heading);
    expect(await templates.findByText('Предложения участников')).toBeInTheDocument();
    expect(templates.getByText('Автор: Настя')).toBeInTheDocument();
    expect(templates.getByText('ваш шаблон')).toBeInTheDocument();

    await person.click(templates.getByRole('button', { name: 'Включить «Кофе»' }));
    await person.click(templates.getByRole('button', { name: 'Отклонить «Метро»' }));

    await waitFor(() => {
      expect(
        requests.some((r) => r.method === 'POST' && r.url === '/api/templates/p1/approve'),
      ).toBe(true);
      expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/templates/p2')).toBe(
        true,
      );
    });
  });

  it('в строке шаблона группы: кто изменил и когда', async () => {
    templatesList = [
      groupTemplate({
        mine: false,
        author: 'Настя',
        updatedBy: 'Петя',
        updatedAt: '2026-10-17T10:00:00Z',
      }),
    ];
    await renderGroup();

    expect(await screen.findByText('Автор: Настя · изменил Петя, 17 окт.')).toBeInTheDocument();
  });

  it('удаление активного шаблона идёт через подтверждение', async () => {
    templatesList = [groupTemplate(), groupTemplate({ id: 'g2', name: 'Свет' })];
    const person = await renderGroup();
    await screen.findByText('Аренда', { exact: false });

    await choose(person, 'Аренда', 'Удалить');
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await person.click(
      within(screen.getByRole('dialog', { name: 'Удалить шаблон?' })).getByRole('button', {
        name: 'Удалить',
      }),
    );

    await waitFor(() =>
      expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/templates/g1')).toBe(
        true,
      ),
    );
  });

  it('порядок: ручка, пробел, стрелка вниз, пробел шлёт новый порядок; «Выше/Ниже» в меню нет', async () => {
    templatesList = [groupTemplate(), groupTemplate({ id: 'g2', name: 'Свет' })];
    const person = await renderGroup();

    const handle = await screen.findByRole('button', { name: 'Переместить шаблон: Аренда' });
    handle.focus();
    await person.keyboard(' {ArrowDown} ');
    await waitFor(() =>
      expect(sent('PUT', '/api/templates/group-order')).toEqual({ ids: ['g2', 'g1'] }),
    );
    expect(requests.some((r) => r.url === '/api/templates/order')).toBe(false);

    await person.click(screen.getByRole('button', { name: 'Действия: Свет' }));
    expect(screen.queryByRole('menuitem', { name: 'Ниже' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Выше' })).toBeNull();
  });

  it('«Новый» создаёт групповой шаблон без выбора, кому он виден', async () => {
    const person = await renderGroup();
    const heading = await screen.findByRole('region', { name: 'Шаблоны группы' });

    await person.click(within(heading).getByRole('button', { name: 'Новый' }));
    const form = screen.getByRole('dialog', { name: 'Новый шаблон' });

    expect(within(form).queryByText('Кому виден')).toBeNull();
    await person.type(within(form).getByLabelText('Название кнопки'), 'Свет');
    await person.type(within(form).getByLabelText('Наименование расхода'), 'Свет');
    await person.selectOptions(within(form).getByLabelText('Категория'), 'Еда');
    await person.click(within(form).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(sent('POST', '/api/templates')).toMatchObject({ scope: 'group', name: 'Свет' }),
    );
  });

  it('под заголовком объяснение про порядок по умолчанию', async () => {
    await renderGroup();

    expect(
      await screen.findByText(
        'Порядок по умолчанию. Если участник расставил шаблоны сам, новые групповые встанут у него наверх',
      ),
    ).toBeInTheDocument();
  });

  it('без предложений нет лишнего заголовка раздела; с предложениями он есть', async () => {
    await renderGroup();
    const heading = await screen.findByRole('region', { name: 'Шаблоны группы' });
    const card = within(heading);
    expect(card.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('нажатие на ряд открывает правку', async () => {
    templatesList = [groupTemplate()];
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Изменить шаблон: Аренда' }));

    expect(screen.getByRole('dialog', { name: 'Изменить шаблон' })).toBeInTheDocument();
  });
});

describe('карточка «Интеграции»', () => {
  beforeEach(() => {
    groupPath = '/group/integrations';
  });
  const key = (overrides: Record<string, unknown> = {}) => ({
    id: 'k1',
    name: 'iPhone — IDBank',
    prefix: 'etk_ab12',
    createdAt: '2026-10-17T10:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdBy: 'Миша',
    defaultCategory: null,
    ...overrides,
  });
  const integrations = async () => {
    await renderGroup();
    return within(await screen.findByRole('region', { name: 'Интеграции' }));
  };

  it('участник её не видит и ключи не запрашиваются', async () => {
    me = { ...OWNER, role: 'member' };
    await renderGroup();

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/group/api-keys')).toBe(false);
    expect(screen.queryByText('Интеграции')).toBeNull();
  });

  it('подзаголовок, подсказка про цифры карты, пустой список ключей', async () => {
    const card = await integrations();

    expect(
      card.getByText('Автоматическое добавление расходов из уведомлений банка'),
    ).toBeInTheDocument();
    expect(card.getByText(/укажите последние 4 цифры в настройках карты/)).toBeInTheDocument();
    expect(await card.findByText(/Ключей пока нет/)).toBeInTheDocument();
  });

  it('подсказки про цифры нет, когда у карты они указаны', async () => {
    const original = overview;
    templatesList = [];
    override = (method, url) => {
      if (url === '/api/group' && method === 'GET') {
        const data = original();
        data.cards[0] = { ...data.cards[0]!, last4: '5386' } as (typeof data.cards)[0];
        return ok(data);
      }
      return undefined;
    };
    const card = await integrations();

    expect(card.queryByText(/укажите последние 4 цифры/)).toBeNull();
  });

  it('список ключей: имя, маска, даты, статусы; отозванные внизу и приглушены', async () => {
    apiKeys = [
      key({ id: 'k0', name: 'Старый', prefix: 'etk_zz99', revokedAt: '2026-10-16T10:00:00.000Z' }),
      key({ lastUsedAt: new Date().toISOString() }),
      key({ id: 'k2', name: 'Планшет', lastUsedAt: '2026-10-15T10:00:00.000Z' }),
    ];
    const card = await integrations();

    expect(await card.findByText('Создан 17.10.2026 · использован сегодня')).toBeInTheDocument();
    expect(card.getByText('Создан 17.10.2026 · использован 15.10.2026')).toBeInTheDocument();
    expect(card.getAllByText('etk_ab12…')).toHaveLength(2);
    expect(card.getByText('etk_zz99…')).toBeInTheDocument();
    expect(card.getAllByText('Активен')).toHaveLength(2);
    expect(card.getByText('Отозван')).toBeInTheDocument();
    const names = card
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
      .filter((text) => text.includes('Создан '));
    expect(names[names.length - 1]).toContain('Старый');
    expect(card.queryByRole('button', { name: 'Действия: Старый' })).toBeNull();
  });

  it('отзыв: подтверждение с текстом, потом DELETE', async () => {
    apiKeys = [key()];
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Действия: iPhone — IDBank' }));
    await person.click(screen.getByRole('menuitem', { name: 'Отозвать' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Отозвать ключ?' }));
    expect(
      dialog.getByText(
        'Отозвать ключ «iPhone — IDBank»? Автоматизация на телефоне сразу перестанет работать',
      ),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await person.click(dialog.getByRole('button', { name: 'Отозвать' }));

    await waitFor(() =>
      expect(
        requests.some((r) => r.method === 'DELETE' && r.url === '/api/group/api-keys/k1'),
      ).toBe(true),
    );
  });

  it('создание: имя по умолчанию, ключ показывается один раз и исчезает после закрытия', async () => {
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Создать API-ключ' }));
    const name = screen.getByLabelText('Название ключа');
    expect(name).toHaveValue('iPhone — IDBank');
    expect(name).toHaveAttribute('maxlength', '60');
    await person.click(screen.getByRole('button', { name: 'Создать' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Ключ создан' }));
    expect(sent('POST', '/api/group/api-keys')).toEqual({ name: 'iPhone — IDBank' });
    expect(
      dialog.getByText('Ключ показывается один раз. Сохраните его сейчас'),
    ).toBeInTheDocument();
    expect(dialog.getByLabelText('API-ключ')).toHaveValue('etk_FULLSECRETKEY123');
    expect(dialog.getByLabelText('Адрес для запроса (URL)')).toHaveValue(
      `${window.location.origin}/api/v1/transactions/import`,
    );
    expect(dialog.getByText('Как настроить IDBank (push-уведомления)')).toBeInTheDocument();

    await person.click(dialog.getByRole('button', { name: 'Готово, ключ сохранён' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain('etk_FULLSECRETKEY123');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('FULLSECRET');
  });

  it('кнопки «Копировать» кладут ключ и адрес в буфер и пишут «Скопировано»', async () => {
    const writeText = vi.fn(async () => undefined);
    const person = await renderGroup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await person.click(await screen.findByRole('button', { name: 'Создать API-ключ' }));
    await person.click(screen.getByRole('button', { name: 'Создать' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ключ создан' }));

    await person.click(dialog.getByRole('button', { name: 'Копировать: API-ключ' }));
    expect(writeText).toHaveBeenCalledWith('etk_FULLSECRETKEY123');
    expect(await dialog.findByText('Скопировано')).toBeInTheDocument();
    await person.click(dialog.getByRole('button', { name: 'Копировать: Адрес для запроса (URL)' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/v1/transactions/import`);
  });

  it('инструкция закрыта по умолчанию, внутри шаги и примечание', async () => {
    const card = await integrations();
    const details = card.getByText('Как настроить IDBank (push-уведомления)').closest('details')!;

    expect(details).not.toHaveAttribute('open');
    expect(
      within(details).getByText(/триггер «Уведомление», приложение IDBank/),
    ).toBeInTheDocument();
    expect(within(details).getByText(/Это переменные Команд/)).toBeInTheDocument();
    expect(within(details).getByText(/проверьте на реальном уведомлении/)).toBeInTheDocument();
    expect(within(details).getAllByRole('listitem')).toHaveLength(7);
    expect(within(details).getByText(/Необязательно: поле/)).toBeInTheDocument();
  });
});

describe('категория по умолчанию у API-ключа', () => {
  beforeEach(() => {
    groupPath = '/group/integrations';
  });
  const baseKey = {
    id: 'k1',
    name: 'iPhone — IDBank',
    prefix: 'etk_ab12',
    createdAt: '2026-10-17T10:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdBy: 'Миша',
    defaultCategory: null,
  };

  it('в строке ключа видно категорию или «не выбрана»', async () => {
    apiKeys = [
      { ...baseKey, defaultCategory: 'Еда' },
      { ...baseKey, id: 'k2', name: 'Планшет' },
    ];
    await renderGroup();

    expect(await screen.findByText('Категория по умолчанию: Еда')).toBeInTheDocument();
    expect(screen.getByText('Категория по умолчанию: не выбрана')).toBeInTheDocument();
  });

  it('создание: выбор из активных категорий, пояснение и первый пункт; категория уходит в POST', async () => {
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Создать API-ключ' }));
    const select = screen.getByLabelText('Категория по умолчанию');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Не выбрана (будет «другое»)', 'Еда']);
    expect(
      screen.getByText('Для расходов из банка, если по такому магазину у вас ещё нет трат'),
    ).toBeInTheDocument();
    await person.selectOptions(select, 'Еда');
    await person.click(screen.getByRole('button', { name: 'Создать' }));

    await screen.findByRole('dialog', { name: 'Ключ создан' });
    expect(sent('POST', '/api/group/api-keys')).toEqual({
      name: 'iPhone — IDBank',
      defaultCategory: 'Еда',
    });
  });

  it('без выбора категории в POST её нет', async () => {
    const person = await renderGroup();
    await person.click(await screen.findByRole('button', { name: 'Создать API-ключ' }));
    await person.click(screen.getByRole('button', { name: 'Создать' }));

    await screen.findByRole('dialog', { name: 'Ключ создан' });
    expect(sent('POST', '/api/group/api-keys')).toEqual({ name: 'iPhone — IDBank' });
  });

  it('«Изменить» открывает окно с именем и категорией, PATCH шлёт изменения', async () => {
    apiKeys = [{ ...baseKey, defaultCategory: 'Еда' }];
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Действия: iPhone — IDBank' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Изменить',
      'Отозвать',
    ]);
    await person.click(screen.getByRole('menuitem', { name: 'Изменить' }));
    const name = screen.getByLabelText('Название ключа');
    expect(name).toHaveValue('iPhone — IDBank');
    expect(screen.getByLabelText('Категория по умолчанию')).toHaveValue('Еда');
    await person.clear(name);
    await person.type(name, 'Планшет');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(sent('PATCH', '/api/group/api-keys/k1')).toEqual({
        name: 'Планшет',
        defaultCategory: 'Еда',
      }),
    );
  });

  it('выбор «Не выбрана» очищает категорию: PATCH с null', async () => {
    apiKeys = [{ ...baseKey, defaultCategory: 'Еда' }];
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Действия: iPhone — IDBank' }));
    await person.click(screen.getByRole('menuitem', { name: 'Изменить' }));
    await person.selectOptions(screen.getByLabelText('Категория по умолчанию'), '');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(sent('PATCH', '/api/group/api-keys/k1')).toEqual({
        name: 'iPhone — IDBank',
        defaultCategory: null,
      }),
    );
  });

  it('ошибка сервера (категория не из списка) показывается в окне, окно остаётся', async () => {
    apiKeys = [{ ...baseKey }];
    override = (method, url) =>
      method === 'PATCH' && url === '/api/group/api-keys/k1'
        ? failure('INVALID_CATEGORY', 'Выберите категорию из списка', 422)
        : undefined;
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: 'Действия: iPhone — IDBank' }));
    await person.click(screen.getByRole('menuitem', { name: 'Изменить' }));
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Выберите категорию из списка')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Изменить ключ/ })).toBeInTheDocument();
  });

  it('у отозванного ключа меню нет', async () => {
    apiKeys = [{ ...baseKey, revokedAt: '2026-10-16T10:00:00.000Z' }];
    await renderGroup();

    expect(await screen.findByText('Отозван')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Действия: iPhone — IDBank' })).toBeNull();
  });
});

describe('цифры карты', () => {
  beforeEach(() => {
    groupPath = '/group/cards';
  });
  it('поле в меню карты: подсказка, ввод только цифр, проверка, сохранение через PATCH', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await choose(person, 'Общая', 'Цифры карты');
    const field = screen.getByLabelText('Последние 4 цифры карты');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAttribute('maxlength', '4');
    expect(
      screen.getByText('Нужны, чтобы расходы из банка попадали на эту карту'),
    ).toBeInTheDocument();

    await person.type(field, '12ab3');
    expect(field).toHaveValue('123');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Укажите последние четыре цифры карты')).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'PATCH' && r.url === '/api/group/cards/11')).toBe(
      false,
    );

    await person.type(field, '4');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/api/group/cards/11')).toEqual({ last4: '1234' }));
  });

  it('пустое поле очищает цифры (null)', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });

    await choose(person, 'Общая', 'Цифры карты');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/api/group/cards/11')).toEqual({ last4: null }));
  });
});

describe('журнал запросов', () => {
  beforeEach(() => {
    groupPath = '/group/integrations';
  });
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: 'l1',
    receivedAt: '2026-10-17T10:14:00.000Z',
    source: 'idbank',
    keyName: 'iPhone — IDBank',
    status: 'created',
    error: null,
    rawPayload: { source: 'idbank', title: 'GNUM', body: 'Покупка 1500 AMD' },
    parsed: {
      amount: 1500,
      currency: 'AMD',
      merchant: 'Sorriso',
      occurredAt: '2026-10-17T10:14:00.000Z',
      localDate: '2026-10-17',
      cardLast4: '5386',
    },
    match: null,
    expenseId: 'e1',
    ...overrides,
  });
  const log = async () => {
    await renderGroup();
    const heading = await screen.findByRole('region', { name: 'Интеграции' });
    return within(heading);
  };

  it('свёрнут по умолчанию, счётчик, пояснение и старый адрес не запрашивается', async () => {
    importLog = [entry(), entry({ id: 'l2' })];
    const card = await log();

    const summary = await card.findByText('Журнал запросов');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await waitFor(() => expect(summary.parentElement).toHaveTextContent('2'));
    expect(
      card.getByText('Что пришло на сервер и что с этим сделано. Хранится 30 дней'),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/group/imports')).toBe(false);
    expect(card.queryByText('Последние импорты')).toBeNull();
  });

  it('строка: время, источник, ключ, продавец и сумма, статус «Добавлено»', async () => {
    importLog = [entry()];
    const card = await log();

    expect(await card.findByText('Sorriso')).toBeInTheDocument();
    expect(card.getByText('1500 AMD')).toBeInTheDocument();
    expect(card.getByText('IDBank', { selector: 'span' })).toBeInTheDocument();
    expect(card.getByText('iPhone — IDBank', { selector: 'span' })).toBeInTheDocument();
    expect(card.getByText('Добавлено')).toBeInTheDocument();
  });

  it('фильтр источников шлёт source в запросе', async () => {
    importLog = [
      entry(),
      entry({
        id: 'l2',
        source: 'apple_wallet',
        keyName: 'iPhone — Wallet',
        parsed: null,
        status: 'unrecognized',
      }),
    ];
    const person = await renderGroup();
    await screen.findByText('Журнал запросов');

    await person.click(await screen.findByRole('radio', { name: 'Apple Wallet' }));

    await waitFor(() =>
      expect(
        requests.some((r) => r.url === '/api/group/import-log?limit=30&source=apple_wallet'),
      ).toBe(true),
    );
    expect(screen.getByRole('radio', { name: 'Apple Wallet' })).toBeChecked();
    await waitFor(() => expect(screen.queryByText('Sorriso')).toBeNull());
  });

  it('статусы: «Уже было» с пояснением, «Объединено», «Не распознано» с причиной и подсказкой', async () => {
    importLog = [
      entry({
        id: 'd',
        status: 'duplicate',
        source: 'apple_wallet',
        match: {
          reason: 'merchant',
          source: 'idbank',
          importId: 'i1',
          expenseId: 'e1',
          renamed: { from: 'URARTU ZAQYAN', to: 'Urartu Zaqyan' },
        },
      }),
      entry({ id: 'm', status: 'merged', match: { mergedWalletEvents: ['w1'] } }),
      entry({ id: 'u', status: 'unrecognized', error: 'Нет суммы', parsed: null }),
      entry({ id: 'c', status: 'card_not_found' }),
    ];
    const card = await log();

    expect(await card.findByText('Уже было')).toBeInTheDocument();
    expect(
      card.getByText(
        'совпало с операцией из IDBank, название обновлено: URARTU ZAQYAN → Urartu Zaqyan',
      ),
    ).toBeInTheDocument();
    expect(card.getByText('Объединено')).toBeInTheDocument();
    expect(card.getByText('взято банковским уведомлением')).toBeInTheDocument();
    expect(card.getByText('Не распознано')).toBeInTheDocument();
    expect(
      card.getByText('Нет суммы. Данных недостаточно: запрос сохранён, смотрите JSON'),
    ).toBeInTheDocument();
    const warn = card.getByText('Не распознано').closest('li');
    expect(warn).toHaveAttribute('data-tone', 'warn');
    expect(
      card.getByText('Нет карты с цифрами 5386 · укажите их в настройках карты').closest('li'),
    ).toHaveAttribute('data-tone', 'warn');
  });

  it('раскрытие строки: JSON запроса с неизвестным полем, блок «Устройство», что прочитал сервер', async () => {
    importLog = [
      entry({
        source: 'apple_wallet',
        rawPayload: {
          source: 'apple_wallet',
          merchant: 'Sorriso',
          mysteryField: 'неожиданное',
          device: { model: 'iPhone 15', os: '18.1' },
        },
      }),
    ];
    const person = await renderGroup();

    const row = await screen.findByRole('button', { name: /Показать запрос/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await person.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    const json = screen.getByLabelText('JSON запроса');
    expect(json.tagName).toBe('PRE');
    expect(json.textContent).toContain('"mysteryField": "неожиданное"');
    expect(json.textContent).toContain('\n  "merchant": "Sorriso"');
    expect(screen.getByText('Устройство')).toBeInTheDocument();
    expect(screen.getByLabelText('Устройство').textContent).toContain('"model": "iPhone 15"');
    expect(screen.getByText('Что прочитал сервер')).toBeInTheDocument();
    expect(screen.getByText('Продавец').nextElementSibling).toHaveTextContent('Sorriso');
  });

  it('JSON показывается как текст, не как разметка', async () => {
    importLog = [entry({ rawPayload: { title: '<img src=x onerror=alert(1)>' } })];
    const person = await renderGroup();

    await person.click(await screen.findByRole('button', { name: /Показать запрос/ }));

    expect(screen.getByLabelText('JSON запроса').textContent).toContain('<img src=x');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('«Копировать JSON» кладёт весь запрос в буфер', async () => {
    const writeText = vi.fn(async () => undefined);
    importLog = [entry({ rawPayload: { source: 'idbank', extra: 1 } })];
    const person = await renderGroup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await person.click(await screen.findByRole('button', { name: /Показать запрос/ }));
    await person.click(screen.getByRole('button', { name: 'Копировать JSON' }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ source: 'idbank', extra: 1 }, null, 2));
    expect(await screen.findByText('Скопировано')).toBeInTheDocument();
  });

  it('«Обновить» запрашивает журнал заново', async () => {
    importLog = [entry()];
    const person = await renderGroup();
    await screen.findByText('Sorriso');
    const count = () => requests.filter((r) => r.url.startsWith('/api/group/import-log')).length;
    const before = count();

    await person.click(screen.getByRole('button', { name: 'Обновить' }));

    await waitFor(() => expect(count()).toBe(before + 1));
  });

  it('инструкция Apple Wallet есть, закрыта по умолчанию, с полями и примечаниями', async () => {
    const card = await log();
    const details = card.getByText('Как настроить Apple Wallet (транзакции)').closest('details')!;

    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText(/«Транзакция»: любая категория/)).toBeInTheDocument();
    expect(within(details).getByText(/= apple_wallet/)).toBeInTheDocument();
    expect(within(details).getByText(/Информация об устройстве/)).toBeInTheDocument();
    expect(within(details).getByText(/сначала посмотрите журнал/)).toBeInTheDocument();
    expect(within(details).getByText(/объединит их в один расход/)).toBeInTheDocument();
    expect(within(details).getByLabelText('Адрес для запроса Wallet (URL)')).toHaveValue(
      `${window.location.origin}/api/v1/transactions/import`,
    );
  });

  it('участник журнал не видит и не запрашивает', async () => {
    me = { ...OWNER, role: 'member' };
    await renderGroup();

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.some((r) => r.url.startsWith('/api/group/import-log'))).toBe(false);
  });
});

describe('хаб группы на телефоне', () => {
  beforeEach(() => {
    groupPath = '/group';
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: !query.includes('min-width'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it('заголовок с названием, «‹ Настройки», строки со значениями и бейджем «N новых», блок «Автоматизация»', async () => {
    templatesList = [
      {
        id: 'p1',
        scope: 'group',
        pending: true,
        name: 'Кофе',
        mine: false,
        author: 'Настя',
        editable: true,
      },
      {
        id: 'p2',
        scope: 'group',
        pending: true,
        name: 'Метро',
        mine: false,
        author: 'Петя',
        editable: true,
      },
    ];
    apiKeys = [
      {
        id: 'k1',
        name: 'А',
        prefix: 'etk_a',
        createdAt: '2026-10-17T10:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
        createdBy: 'Миша',
        defaultCategory: null,
      },
      {
        id: 'k2',
        name: 'Б',
        prefix: 'etk_b',
        createdAt: '2026-10-17T10:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
        createdBy: 'Миша',
        defaultCategory: null,
      },
    ];
    await renderGroup();

    expect(
      await screen.findByRole('heading', { name: 'Группа «Семья»', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Настройки/ })).toHaveAttribute('href', '/settings');
    const main = within(screen.getByRole('navigation', { name: 'Разделы' }));
    expect(main.getByRole('link', { name: /Основные/ })).toHaveTextContent(
      'Название, валюта отчётов',
    );
    expect(main.getByRole('link', { name: /Основные/ })).toHaveTextContent('AMD');
    expect(main.getByRole('link', { name: /Участники и приглашения/ })).toHaveTextContent('3');
    expect(main.getByRole('link', { name: /Карты/ })).toHaveTextContent('2');
    expect(main.getByRole('link', { name: /Категории и лимиты/ })).toHaveTextContent('1');
    expect(main.getByRole('link', { name: /Чеки и ИИ/ })).toHaveTextContent(
      'Фото чеков, разбор через ИИ',
    );
    await waitFor(() =>
      expect(main.getByRole('link', { name: /Шаблоны группы/ })).toHaveTextContent('2 новых'),
    );
    const auto = within(screen.getByRole('navigation', { name: 'Автоматизация' }));
    await waitFor(() =>
      expect(auto.getByRole('link', { name: /Интеграции/ })).toHaveTextContent('2 ключа'),
    );
    expect(auto.getByRole('link', { name: /Сообщение участникам/ })).toBeInTheDocument();
  });

  it('строка ведёт в раздел, «‹ Группа» возвращает на хаб', async () => {
    const person = await renderGroup();

    await person.click(await screen.findByRole('link', { name: /Карты/ }));
    expect(await screen.findByRole('heading', { name: 'Карты', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Разделы группы' })).toBeNull();
    const back = screen.getByRole('link', { name: /Группа/ });
    expect(back).toHaveAttribute('href', '/group');
    await person.click(back);

    expect(
      await screen.findByRole('heading', { name: 'Группа «Семья»', level: 2 }),
    ).toBeInTheDocument();
  });

  it('неизвестный раздел ведёт на хаб; участник уходит на главную', async () => {
    groupPath = '/group/xyz';
    await renderGroup();
    expect(
      await screen.findByRole('heading', { name: 'Группа «Семья»', level: 2 }),
    ).toBeInTheDocument();
  });
});
