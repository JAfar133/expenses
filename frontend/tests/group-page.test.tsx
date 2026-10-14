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

async function renderGroup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/group']}>
        <Routes>
          <Route path="group" element={<GroupPage />} />
          <Route path="/" element={<p>Главная</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const sent = (method: string, url: string) =>
  requests.find((r) => r.method === method && r.url === url)?.body;
const section = (name: string | RegExp) =>
  screen.getByRole('heading', { name }).closest('section')!;
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
  it('ровно четыре карточки в порядке: настройки, участники, карты, категории и лимиты', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Настройки группы' });

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Группа',
      'Настройки группы',
      'Участники (3)',
      'Карты (2)',
      'Категории и лимиты (1)',
    ]);
  });

  it('не владельцу не показывает ничего и не запрашивает группу', async () => {
    me = { ...OWNER, role: 'member' };
    await renderGroup();

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/group')).toBe(false);
  });

  it('подсказок две: у «Правка своих трат участниками» и у карточки категорий', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Настройки группы' });

    // The hint of the editing time lives inside its small window now
    expect(card('Настройки группы').queryByRole('button', { name: 'Подсказка' })).toBeNull();
    expect(card(/^Категории и лимиты/).getAllByRole('button', { name: 'Подсказка' })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole('button', { name: 'Подсказка' })).toHaveLength(1);
    expect(card(/^Участники/).queryByRole('button', { name: 'Подсказка' })).toBeNull();
    expect(card(/^Карты/).queryByRole('button', { name: 'Подсказка' })).toBeNull();
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
  it('кнопка с aria-haspopup, открывается кликом, пункты — menuitem', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Карты/ });
    const button = screen.getByRole('button', { name: 'Действия: Общая' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await person.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Переименовать', 'Сменить валюту', 'В архив']);
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

    await person.click(screen.getByRole('heading', { name: 'Группа' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('настройки группы', () => {
  const settings = () => card('Настройки группы');

  it('название — строка со значением; окно открывается по нажатию, PUT /group', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Настройки группы' });
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
    await screen.findByRole('heading', { name: 'Настройки группы' });
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
    await screen.findByRole('heading', { name: 'Настройки группы' });

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
    await screen.findByRole('heading', { name: 'Настройки группы' });

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
    await screen.findByRole('heading', { name: 'Настройки группы' });
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
    await screen.findByRole('heading', { name: 'Настройки группы' });

    await person.click(settings().getByRole('button', { name: /^Правка своих трат участниками/ }));
    await person.selectOptions(
      settings().getByLabelText('Сколько времени участник может править свои траты'),
      'Выключено',
    );

    expect(await settings().findByRole('alert')).toHaveTextContent('Недопустимое значение');
  });

  it('фото чеков: переключатель role=switch; чипы категорий только при включении, без архивных', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Настройки группы' });
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
    await screen.findByRole('heading', { name: 'Настройки группы' });
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
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });

    await person.click(categories().getByRole('button', { name: 'Добавить' }));
    await person.type(dialog().getByLabelText('Название категории'), 'Одежда');
    await person.click(dialog().getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(sent('POST', '/api/group/categories')).toEqual({ name: 'Одежда' }));
  });

  it('меню строки: Переименовать, Лимит…, В архив (Слить — только при нескольких категориях)', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });

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
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });

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
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });
    await categories().findByRole('button', { name: 'Лимит: Все категории' });
    expect(categories().getByText('не задан')).toBeInTheDocument();

    await person.click(categories().getByRole('button', { name: 'Лимит: Все категории' }));

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Лимит: Все категории');
  });

  it('у категории без лимита «—», с лимитом — сумма', async () => {
    budgetsList = [budget({ id: 'b2', categoryId: 20, category: 'Еда', limit: 80000 })];
    await renderGroup();
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });

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
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });

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
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });

    expect(await categories().findByText('80 000 AMD')).toBeInTheDocument();
    expect(categories().queryByText(/Период лимитов/)).toBeNull();
    expect(categories().getByText('80 000 AMD').closest('li')).toHaveTextContent('неделя');
  });
});

describe('диалог лимита', () => {
  const dlg = () => within(screen.getByRole('dialog'));
  const sentAll = (method: string, url: string) =>
    requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

  async function openLimit(person: Awaited<ReturnType<typeof renderGroup>>, name: string) {
    await screen.findByRole('heading', { name: /^Категории и лимиты/ });
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
