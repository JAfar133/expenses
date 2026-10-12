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

beforeEach(() => {
  me = OWNER;
  requests = [];
  override = () => undefined;
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
      if (url === '/api/group/invitations' && method === 'POST')
        return ok({ token: 'TOKEN-1', expiresAt: '2026-10-20T10:00:00.000Z' }, 201);
      if (url.endsWith('/reset-password'))
        return ok({ token: 'RESET-1', expiresAt: '2026-10-20T10:00:00.000Z' }, 201);
      if (url === '/api/group/cards' && method === 'POST') return ok({ id: 99 }, 201);
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
const section = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('страница «Группа»', () => {
  it('показывает все разделы', async () => {
    await renderGroup();

    await screen.findByRole('heading', { name: 'Группа' });
    for (const name of ['Название группы', 'Участники', 'Приглашения', 'Карты', 'Категории']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Семья')).toBeInTheDocument();
  });

  it('не владельцу не показывает ничего и не запрашивает группу', async () => {
    me = { ...OWNER, role: 'member' };
    await renderGroup();

    expect(await screen.findByText('Главная')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/group')).toBe(false);
  });

  it('переименовывает группу', async () => {
    const person = await renderGroup();
    await screen.findByText('Семья');

    await person.click(screen.getByRole('button', { name: 'Переименовать: Семья' }));
    const field = screen.getByLabelText('Новое название: Семья');
    await person.clear(field);
    await person.type(field, 'Наш дом');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(sent('PATCH', '/api/group')).toEqual({ name: 'Наш дом' });
  });
});

describe('карты', () => {
  const cards = () => within(section('Карты'));

  it('добавляет карту', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.type(cards().getByLabelText('Новая карта'), 'Отпуск');
    await person.click(cards().getByRole('button', { name: 'Добавить' }));

    expect(sent('POST', '/api/group/cards')).toEqual({ name: 'Отпуск', currency: 'AMD' });
  });

  it('показывает подсказку о видимости карт', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    expect(
      cards().getByText(
        'Владельцы видят все карты. Участники видят только карты, к которым им дан доступ.',
      ),
    ).toBeInTheDocument();
  });

  it('переименовывает карту', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.click(cards().getByRole('button', { name: 'Переименовать: Общая' }));
    const field = cards().getByLabelText('Новое название: Общая');
    await person.clear(field);
    await person.type(field, 'Семейная');
    await person.click(cards().getByRole('button', { name: 'Сохранить' }));

    expect(sent('PATCH', '/api/group/cards/11')).toEqual({ name: 'Семейная' });
  });

  it('отправляет карту в архив и возвращает из архива', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.click(cards().getByRole('button', { name: 'В архив: Общая' }));
    expect(sent('PATCH', '/api/group/cards/11')).toEqual({ archived: true });

    await person.click(cards().getByText('Архив карт (1)'));
    await person.click(cards().getByRole('button', { name: 'Вернуть: Старая' }));
    expect(sent('PATCH', '/api/group/cards/12')).toEqual({ archived: false });
  });

  it('доступ: отправляет полную карту, «нет доступа» опускается, владельцы не перечислены', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.click(cards().getByRole('button', { name: 'Доступ: Миша' }));
    expect(cards().queryByLabelText(/Доступ к карте «Миша»: Миша/)).toBeNull();
    await person.selectOptions(cards().getByLabelText('Доступ к карте «Миша»: Петя'), 'edit');

    expect(sent('PUT', '/api/group/cards/10/access')).toEqual({
      access: { nastya: 'view', petya: 'edit' },
    });
  });

  it('доступ: выбор «нет доступа» убирает участника из карты', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.click(cards().getByRole('button', { name: 'Доступ: Миша' }));
    await person.selectOptions(cards().getByLabelText('Доступ к карте «Миша»: Настя'), 'none');

    expect(sent('PUT', '/api/group/cards/10/access')).toEqual({ access: {} });
  });

  it('ошибка NAME_TAKEN показывается сообщением сервера', async () => {
    override = (method, url) =>
      method === 'POST' && url === '/api/group/cards'
        ? failure('NAME_TAKEN', 'Карта с таким названием уже есть', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.type(cards().getByLabelText('Новая карта'), 'Общая');
    await person.click(cards().getByRole('button', { name: 'Добавить' }));

    expect(await cards().findByRole('alert')).toHaveTextContent('Карта с таким названием уже есть');
  });
});

describe('валюты карт', () => {
  const cards = () => within(section('Карты'));

  it('у каждой карты видна её валюта', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({
            ...overview(),
            cards: overview().cards.map((c) => (c.id === 11 ? { ...c, currency: 'USD' } : c)),
          })
        : undefined;
    await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    expect(cards().getByText('Общая').closest('li')).toHaveTextContent('USD');
    expect(cards().getByText('Миша').closest('li')).toHaveTextContent('AMD');
  });

  it('новая карта: валюта по умолчанию — валюта отчётности, выбранная уходит на сервер', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    const select = cards().getByLabelText('Валюта новой карты');
    expect(select).toHaveValue('AMD');
    await person.selectOptions(select, 'USD');
    await person.type(cards().getByLabelText('Новая карта'), 'Отпуск');
    await person.click(cards().getByRole('button', { name: 'Добавить' }));

    expect(sent('POST', '/api/group/cards')).toEqual({ name: 'Отпуск', currency: 'USD' });
  });

  it('если разрешена одна валюта, выбора валюты нет, на сервер уходит только название', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({ ...overview(), currencies: ['AMD'] })
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    expect(cards().queryByLabelText('Валюта новой карты')).toBeNull();
    await person.type(cards().getByLabelText('Новая карта'), 'Отпуск');
    await person.click(cards().getByRole('button', { name: 'Добавить' }));

    expect(sent('POST', '/api/group/cards')).toEqual({ name: 'Отпуск' });
  });

  it('смена валюты в режиме правки отправляет только валюту', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.click(cards().getByRole('button', { name: 'Переименовать: Общая' }));
    await person.selectOptions(cards().getByLabelText('Валюта: Общая'), 'USD');
    await person.click(cards().getByRole('button', { name: 'Сохранить' }));

    expect(sent('PATCH', '/api/group/cards/11')).toEqual({ currency: 'USD' });
  });

  it('сообщение CARD_HAS_EXPENSES показывается как есть', async () => {
    override = (method, url) =>
      method === 'PATCH' && url === '/api/group/cards/11'
        ? failure('CARD_HAS_EXPENSES', 'По карте уже есть траты: валюту не изменить', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    await person.click(cards().getByRole('button', { name: 'Переименовать: Общая' }));
    await person.selectOptions(cards().getByLabelText('Валюта: Общая'), 'USD');
    await person.click(cards().getByRole('button', { name: 'Сохранить' }));

    expect(await cards().findByRole('alert')).toHaveTextContent('По карте уже есть траты');
  });
});

describe('правка своих трат участниками', () => {
  const edit = () => within(section('Правка своих трат участниками'));

  it('показывает текущее значение и стоит сразу после названия группы', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Правка своих трат участниками' });

    expect(edit().getByRole('combobox')).toHaveValue('1440');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Правка своих трат участниками')).toBe(
      headings.indexOf('Название группы') + 1,
    );
  });

  it.each([
    ['Выключено', 0],
    ['15 минут', 15],
    ['1 час', 60],
    ['24 часа', 1440],
    ['Неделя', 10080],
  ])('«%s» сохраняется сразу: PUT с minutes %i', async (label, minutes) => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Правка своих трат участниками' });
    // Pick a different value first so that the select really changes
    const select = edit().getByRole('combobox');
    if (minutes === 1440) await person.selectOptions(select, 'Неделя');

    await person.selectOptions(select, label);

    await waitFor(() =>
      expect(requests.filter((r) => r.url === '/api/group/member-edit').at(-1)?.body).toEqual({
        minutes,
      }),
    );
  });

  it('ошибка сервера показывается', async () => {
    override = (method, url) =>
      method === 'PUT' && url === '/api/group/member-edit'
        ? failure('INVALID_MINUTES', 'Недопустимое значение', 422)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Правка своих трат участниками' });

    await person.selectOptions(edit().getByRole('combobox'), 'Выключено');

    expect(await edit().findByRole('alert')).toHaveTextContent('Недопустимое значение');
  });
});

describe('валюта отчётности', () => {
  const reporting = () => within(section('Валюта отчётности'));

  it('показывает текущую валюту; смена — с подтверждением, PUT и сообщение о пересчёте', async () => {
    override = (method, url) =>
      method === 'PUT' && url === '/api/group/reporting-currency'
        ? ok({ recalculated: 3 })
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Валюта отчётности' });

    expect(reporting().getByText('AMD', { selector: 'span' })).toBeInTheDocument();
    expect(reporting().getByRole('button', { name: 'Изменить' })).toBeDisabled();
    await person.selectOptions(reporting().getByLabelText('Новая валюта отчётности'), 'USD');
    await person.click(reporting().getByRole('button', { name: 'Изменить' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Все суммы пересчитаются в USD');
    expect(dialog).toHaveTextContent('Это нельзя отменить');
    expect(sent('PUT', '/api/group/reporting-currency')).toBeUndefined();
    await person.click(within(dialog).getByRole('button', { name: 'Сменить' }));

    expect(sent('PUT', '/api/group/reporting-currency')).toEqual({ currency: 'USD' });
    expect(await reporting().findByText('Пересчитано трат: 3')).toBeInTheDocument();
    // The group is loaded again: totals changed
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'GET' && r.url === '/api/group')).toHaveLength(2),
    );
  });

  it('ошибка сервера показывается, подтверждение закрывается', async () => {
    override = (method, url) =>
      method === 'PUT' && url === '/api/group/reporting-currency'
        ? failure('RATE_UNAVAILABLE', 'Курс валюты недоступен', 422)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Валюта отчётности' });

    await person.selectOptions(reporting().getByLabelText('Новая валюта отчётности'), 'USD');
    await person.click(reporting().getByRole('button', { name: 'Изменить' }));
    await person.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сменить' }));

    expect(await reporting().findByRole('alert')).toHaveTextContent('Курс валюты недоступен');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('категории', () => {
  it('добавляет, архивирует и возвращает категории', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Категории' });
    const categories = within(section('Категории'));

    await person.type(categories.getByLabelText('Новая категория'), 'Одежда');
    await person.click(categories.getByRole('button', { name: 'Добавить' }));
    expect(sent('POST', '/api/group/categories')).toEqual({ name: 'Одежда' });

    await person.click(categories.getByRole('button', { name: 'В архив: Еда' }));
    expect(sent('PATCH', '/api/group/categories/20')).toEqual({ archived: true });

    await person.click(categories.getByText('Архив категорий (1)'));
    await person.click(categories.getByRole('button', { name: 'Вернуть: Игры' }));
    expect(sent('PATCH', '/api/group/categories/21')).toEqual({ archived: false });
  });
});

describe('объединение категорий', () => {
  it('отправляет mergeInto и убирает категорию из списка после обновления', async () => {
    let categories = [
      { id: 20, name: 'Еда', archived: false },
      { id: 22, name: 'Продукты', archived: false },
    ];
    override = (method, url) => {
      if (method === 'GET' && url === '/api/group') return ok({ ...overview(), categories });
      if (method === 'PATCH' && url === '/api/group/categories/22') {
        categories = categories.filter((c) => c.id !== 22);
        return ok({});
      }
      return undefined;
    };
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Категории' });
    const list = within(section('Категории'));

    await person.click(list.getByRole('button', { name: 'Объединить: Продукты' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/Все траты категории «Продукты» перейдут в «Еда»/),
    ).toBeInTheDocument();
    await person.click(within(dialog).getByRole('button', { name: 'Объединить' }));

    expect(sent('PATCH', '/api/group/categories/22')).toEqual({ mergeInto: 20 });
    await waitFor(() => expect(list.queryByText('Продукты')).toBeNull());
  });

  it('с единственной категорией «Объединить» не предлагается', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({ ...overview(), categories: [{ id: 20, name: 'Еда', archived: false }] })
        : undefined;
    await renderGroup();
    await screen.findByRole('heading', { name: 'Категории' });

    expect(screen.queryByRole('button', { name: /^Объединить:/ })).toBeNull();
  });
});

describe('подсказки', () => {
  it('у раздела одна подсказка с текстом по каждому действию', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Категории' });
    const categories = within(section('Категории'));

    expect(categories.getAllByRole('button', { name: 'Подсказка' })).toHaveLength(1);
    await person.click(categories.getByRole('button', { name: 'Подсказка' }));

    expect(categories.getByText(/Список категорий вашей группы/)).toBeInTheDocument();
    expect(categories.getByText(/переносит все траты в другую категорию/)).toBeInTheDocument();
  });

  it('подсказка раздела «Участники» объясняет «Убрать» и сброс пароля', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });
    const members = within(section('Участники'));

    await person.click(members.getByRole('button', { name: 'Подсказка' }));

    expect(members.getByText(/Вернуть можно только новым приглашением/)).toBeInTheDocument();
    expect(members.getByText(/одноразовая, на 7 дней/)).toBeInTheDocument();
  });

  it('в строках списков нет кнопок «Подсказка»', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    for (const row of screen.getAllByRole('listitem')) {
      expect(within(row).queryByRole('button', { name: 'Подсказка' })).toBeNull();
    }
    // One hint per section: name, member edit, reporting currency, members, invitations, cards, categories
    expect(screen.getAllByRole('button', { name: 'Подсказка' })).toHaveLength(7);
  });
});

describe('кнопки-иконки', () => {
  it('у каждой иконки есть aria-label и такой же title', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    for (const name of ['Переименовать: Общая', 'Доступ: Общая', 'В архив: Общая']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('title', name);
      expect(button).not.toHaveTextContent(/\S/);
    }
  });
});

describe('приглашения', () => {
  const invitations = () => within(section('Приглашения'));

  it('создаёт приглашение и показывает ссылку с токеном', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Приглашения' });

    await person.selectOptions(invitations().getByLabelText('Роль приглашённого'), 'owner');
    await person.click(invitations().getByRole('button', { name: 'Пригласить' }));

    expect(await invitations().findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/TOKEN-1`,
    );
    expect(sent('POST', '/api/group/invitations')).toEqual({ role: 'owner' });
    expect(invitations().getByRole('button', { name: 'Скопировать' })).toBeInTheDocument();
    expect(invitations().getAllByText(/действует до/)).toHaveLength(3);
  });

  it('список ожидающих приглашений и отзыв', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Приглашения' });

    expect(invitations().getByText('Приглашение · Участник')).toBeInTheDocument();
    expect(invitations().getByText('Сброс пароля · nastya')).toBeInTheDocument();

    await person.click(
      invitations().getByRole('button', { name: 'Отозвать: Приглашение · Участник' }),
    );

    expect(
      requests.some((r) => r.method === 'DELETE' && r.url === '/api/group/invitations/30'),
    ).toBe(true);
  });
});

describe('участники', () => {
  const members = () => within(section('Участники'));

  it('показывает роли и не предлагает действий для себя', async () => {
    await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    const mishaRow = members().getByText('Миша').closest('li')!;
    expect(within(mishaRow).getByText('Владелец')).toBeInTheDocument();
    expect(within(mishaRow).queryByRole('button')).toBeNull();
  });

  it('меняет роль', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    await person.click(members().getByRole('button', { name: 'Сделать владельцем: Настя' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Роль «Владелец» для: Настя');
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Сделать владельцем' }),
    );

    expect(sent('PUT', '/api/group/members/nastya/role')).toEqual({ role: 'owner' });
  });

  it('показывает ошибку LAST_EDITOR', async () => {
    override = (method, url) =>
      method === 'PUT' && url.endsWith('/role')
        ? failure('LAST_EDITOR', 'Нельзя убрать последнего владельца', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    await person.click(members().getByRole('button', { name: 'Сделать владельцем: Настя' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Сделать владельцем' }),
    );

    expect(await members().findByRole('alert')).toHaveTextContent('последнего владельца');
  });

  it('создаёт ссылку для сброса пароля', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    await person.click(members().getByRole('button', { name: 'Ссылка для сброса пароля: Настя' }));

    expect(await members().findByLabelText('Ссылка')).toHaveValue(
      `${window.location.origin}/invite/RESET-1`,
    );
  });

  it('«Убрать» не предлагается для участников из настроек сервера; убирает с подтверждением', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    expect(members().queryByRole('button', { name: 'Убрать: Петя' })).toBeNull();

    await person.click(members().getByRole('button', { name: 'Убрать: Настя' }));
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    const dialog = screen.getByRole('dialog');
    await person.click(within(dialog).getByRole('button', { name: 'Убрать' }));

    expect(
      requests.some((r) => r.method === 'DELETE' && r.url === '/api/group/members/nastya'),
    ).toBe(true);
  });
});

describe('роль владельца', () => {
  it('владельца можно сделать участником (подтверждение, PUT member)', async () => {
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
    await screen.findByRole('heading', { name: 'Участники' });

    await person.click(
      within(section('Участники')).getByRole('button', { name: 'Сделать участником: Настя' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Роль «Участник» для: Настя');
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Сделать участником' }),
    );

    expect(sent('PUT', '/api/group/members/nastya/role')).toEqual({ role: 'member' });
  });
});

describe('без участников', () => {
  it('если в группе только владельцы, управления доступом нет', async () => {
    override = (method, url) =>
      method === 'GET' && url === '/api/group'
        ? ok({ ...overview(), members: overview().members.slice(0, 1) })
        : undefined;
    await renderGroup();
    await screen.findByRole('heading', { name: 'Карты' });

    expect(screen.queryByRole('button', { name: /^Доступ:/ })).toBeNull();
  });
});
