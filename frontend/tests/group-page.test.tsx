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
  },
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

    expect(sent('POST', '/api/group/cards')).toEqual({ name: 'Отпуск' });
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
    // One hint per section: name, members, invitations, cards, categories
    expect(screen.getAllByRole('button', { name: 'Подсказка' })).toHaveLength(5);
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
    expect(members().queryByLabelText('Роль: Миша')).toBeNull();
  });

  it('меняет роль', async () => {
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    await person.selectOptions(members().getByLabelText('Роль: Настя'), 'owner');

    expect(sent('PUT', '/api/group/members/nastya/role')).toEqual({ role: 'owner' });
  });

  it('показывает ошибку LAST_EDITOR', async () => {
    override = (method, url) =>
      method === 'PUT' && url.endsWith('/role')
        ? failure('LAST_EDITOR', 'Нельзя убрать последнего владельца', 409)
        : undefined;
    const person = await renderGroup();
    await screen.findByRole('heading', { name: 'Участники' });

    await person.selectOptions(members().getByLabelText('Роль: Настя'), 'owner');

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
