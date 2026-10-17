import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMOJIS } from '../src/features/templates/components/EmojiPicker.tsx';
import { TemplatesCard } from '../src/features/templates/components/TemplatesCard.tsx';
import type { Template } from '../src/features/templates/api/templates.api.ts';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json(status, { success: true, data });

const USER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  role: 'owner' as const,
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};

const template = (overrides: Partial<Template> = {}): Template => ({
  id: 't1',
  scope: 'personal',
  pending: false,
  sharedStatus: null,
  name: 'Кофе',
  emoji: null,
  category: 'кафе',
  card: null,
  effectiveCard: 'Миша',
  expenseName: 'Кофе',
  amount: 1200,
  currency: 'AMD',
  editable: true,
  mine: true,
  author: 'Миша',
  updatedBy: null,
  updatedAt: null,
  hidden: false,
  unavailable: false,
  ...overrides,
});

let templates: Template[];
let orderFails = false;
let createFailsWithCard = false;
let role: 'owner' | 'member';
let preferences: Record<string, unknown>;
let calls: { method: string; url: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  templates = [];
  orderFails = false;
  createFailsWithCard = false;
  role = 'member';
  preferences = {};
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/auth/me') return ok({ user: { ...USER, role } });
      if (url === '/api/cards') return ok([{ name: 'Миша', currency: 'AMD' }]);
      if (url === '/api/categories') return ok(['кафе', 'продукты']);
      if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD', 'USD'], rates: [] });
      if (url === '/api/name-suggestions') return ok([]);
      if (url === '/api/budgets') return ok([]);
      if (url === '/api/receipts/settings') return ok({ enabled: false, categories: [] });
      if (url === '/api/preferences' && method === 'GET') return ok(preferences);
      if (url === '/api/preferences' && method === 'PUT') {
        preferences = { ...preferences, ...body };
        return ok(preferences);
      }
      if (url === '/api/templates/order' && orderFails) {
        return json(500, {
          success: false,
          error: { code: 'X', message: 'Не удалось сохранить порядок' },
        });
      }
      if (url === '/api/templates' && method === 'GET') return ok(templates);
      if (url === '/api/templates' && method === 'POST') return ok({ id: 'new' }, 201);
      if (url.startsWith('/api/templates/')) return ok(null);
      if (url === '/api/expenses' && method === 'POST' && createFailsWithCard) {
        return json(400, {
          success: false,
          error: { code: 'INVALID_CARD', message: 'Выберите карту из списка' },
        });
      }
      if (url === '/api/expenses' && method === 'POST') {
        return ok(
          { id: 'e1', excelStatus: 'synced', ...body, currency: 'AMD', original: null },
          201,
        );
      }
      if (url === '/api/expenses/e1' && method === 'DELETE') return ok({ id: 'e1' });
      if (url.startsWith('/api/analytics/')) throw new Error('no analytics');
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function renderPage() {
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <AddExpensePage user={USER} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Добавить расход' });
  return userEvent.setup();
}

const posted = () => calls.filter((c) => c.method === 'POST' && c.url === '/api/expenses');

describe('полоска шаблонов над формой', () => {
  it('без шаблонов ничего нового на экране нет', async () => {
    await renderPage();

    await waitFor(() => expect(calls.some((c) => c.url === '/api/templates')).toBe(true));
    expect(screen.queryByRole('group', { name: 'Быстрые траты' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Быстрые траты' })).toBeNull();
  });

  it('первые три шаблона чипами (с суммой на чипе) и «Все»', async () => {
    templates = [1, 2, 3, 4].map((n) => template({ id: `t${n}`, name: `Шаблон ${n}` }));
    await renderPage();

    const strip = await screen.findByRole('group', { name: 'Быстрые траты' });
    const names = within(strip)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names).toEqual(['Шаблон 11 200', 'Шаблон 21 200', 'Шаблон 31 200', 'Все']);
  });

  it('шаблон с суммой создаёт расход сразу, «Отменить» его удаляет', async () => {
    templates = [template({ effectiveCard: 'Миша' })];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Кофе/ }));

    await screen.findByText(/Добавлено · Кофе · 1\s?200 AMD/);
    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.body).toMatchObject({
      card: 'Миша',
      category: 'кафе',
      name: 'Кофе',
      amount: 1200,
      currency: 'AMD',
    });

    await person.click(screen.getByRole('button', { name: 'Отменить' }));
    await screen.findByText('Расход отменён');
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/expenses/e1')).toBe(true);
  });

  it('шаблон без суммы заполняет форму и ничего не сохраняет', async () => {
    templates = [
      template({
        amount: null,
        currency: null,
        category: 'продукты',
        name: 'Магазин',
        expenseName: 'Продукты',
      }),
    ];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: 'Магазин' }));

    await waitFor(() => expect(screen.getByLabelText('Категория')).toHaveValue('продукты'));
    expect(screen.getByLabelText('Наименование')).toHaveValue('Продукты');
    expect(screen.getByLabelText('Стоимость')).toHaveFocus();
    expect(posted()).toHaveLength(0);
  });

  it('«Все»: один плоский список без разделов, «В форму» кладёт шаблон с суммой в форму', async () => {
    templates = [
      template(),
      template({
        id: 't2',
        scope: 'group',
        name: 'Аренда',
        category: 'продукты',
        expenseName: 'Аренда',
        amount: 350000,
        mine: false,
        editable: false,
      }),
    ];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Все/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Быстрые траты' });
    expect(within(dialog).queryByRole('region')).toBeNull();
    expect(within(dialog).queryByRole('heading', { level: 3 })).toBeNull();
    expect(within(dialog).getAllByText('Группа')).toHaveLength(1);

    await person.click(within(dialog).getByRole('button', { name: 'Аренда: открыть в форме' }));

    await waitFor(() => expect(screen.getByLabelText('Наименование')).toHaveValue('Аренда'));
    expect(screen.getByLabelText('Стоимость')).toHaveValue('350 000');
    expect(posted()).toHaveLength(0);
  });

  it('скрытые, недоступные и (при «скрыть все групповые») групповые шаблоны не показываются', async () => {
    preferences = { 'templates.hideGroup': true };
    templates = [
      template({ id: 'a', name: 'Скрытый', scope: 'group', hidden: true }),
      template({ id: 'b', name: 'Архивный', unavailable: true }),
      template({ id: 'c', name: 'Групповой', scope: 'group' }),
      template({ id: 'd', name: 'Мой' }),
    ];
    await renderPage();

    const strip = await screen.findByRole('group', { name: 'Быстрые траты' });
    expect(
      within(strip)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Мой1 200', 'Все']);
  });

  it('полоска выключена: остаётся только значок молнии, он открывает панель', async () => {
    preferences = { 'templates.strip': false };
    templates = [template()];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: 'Быстрые траты' }));

    expect(screen.queryByRole('group', { name: 'Быстрые траты' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Быстрые траты' })).toBeInTheDocument();
  });
});

describe('«Сохранить как шаблон» после расхода', () => {
  it('диалог открывается с данными расхода и создаёт шаблон', async () => {
    const person = await renderPage();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Наименование'), 'Латте');
    await person.type(screen.getByLabelText('Стоимость'), '900');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await person.click(await screen.findByRole('button', { name: 'Сохранить как шаблон' }));

    const dialog = await screen.findByRole('dialog', { name: 'Новый шаблон' });
    expect(within(dialog).getByLabelText('Название кнопки')).toHaveValue('Латте');
    expect(within(dialog).getByLabelText('Категория')).toHaveValue('кафе');
    expect(within(dialog).getByLabelText('Сумма')).toHaveValue('900');

    await person.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/templates')).toBe(true),
    );
    expect(
      calls.find((c) => c.method === 'POST' && c.url === '/api/templates')!.body,
    ).toMatchObject({
      scope: 'personal',
      name: 'Латте',
      category: 'кафе',
      expenseName: 'Латте',
      amount: 900,
    });
  });

  it('если такой шаблон уже есть, не предлагается', async () => {
    templates = [template({ name: 'Моё утро', expenseName: 'Латте' })];
    const person = await renderPage();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Наименование'), 'Латте');
    await person.type(screen.getByLabelText('Стоимость'), '900');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await screen.findByText(/Расход успешно добавлен/);
    expect(screen.queryByRole('button', { name: 'Сохранить как шаблон' })).toBeNull();
  });

  it('пустое название не отправляется', async () => {
    const person = await renderPage();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Наименование'), 'Латте');
    await person.type(screen.getByLabelText('Стоимость'), '900');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));
    await person.click(await screen.findByRole('button', { name: 'Сохранить как шаблон' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый шаблон' });

    await person.clear(within(dialog).getByLabelText('Название кнопки'));
    await person.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(await within(dialog).findByText('Введите название кнопки')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/templates')).toBe(false);
  });
});

describe('настройки шаблонов', () => {
  const renderCard = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  const groupRow = () =>
    (templates = [
      template({ id: 'g', scope: 'group', name: 'Аренда', mine: false, editable: false }),
    ]);

  it('«Как показывать»: два выбора сохраняются под прежними ключами', async () => {
    groupRow();
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('radio', { name: 'Скрыть все' }));
    await person.click(screen.getByRole('radio', { name: 'Только значок ⚡' }));

    await waitFor(() =>
      expect(preferences).toEqual({ 'templates.hideGroup': true, 'templates.strip': false }),
    );
  });

  it('пояснение под выбором описывает текущий вариант и меняется вместе с ним', async () => {
    groupRow();
    renderCard();
    const person = userEvent.setup();

    await screen.findByRole('radio', { name: 'Скрыть все' });
    expect(
      screen.getByText(
        'Три первых шаблона показаны кнопками над полями формы, остальные в списке «Все»',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Групповые шаблоны доступны наравне с вашими')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Кнопки' })).toBeChecked();

    await person.click(screen.getByRole('radio', { name: 'Только значок ⚡' }));
    await person.click(screen.getByRole('radio', { name: 'Скрыть все' }));

    expect(
      await screen.findByText(
        'Над формой остаётся только значок ⚡, шаблоны открываются по нажатию',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Групповые шаблоны не показываются нигде, остаются только ваши. Вернуть их можно здесь же',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Скрыть все' })).toBeChecked();
  });

  it('выбор «Шаблоны группы» не показывается, если в группе нет шаблонов', async () => {
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();

    expect(await screen.findByText('Над формой «Добавить»')).toBeInTheDocument();
    expect(screen.queryByText('Шаблоны группы')).toBeNull();
  });

  it('под заголовком «Группа» есть подсказка', async () => {
    groupRow();
    renderCard();

    expect(
      await screen.findByText('Шаблоны группы видят все участники. Скрыть можно только у себя'),
    ).toBeInTheDocument();
  });

  it('групповой шаблон: кнопка «Виден» скрывает его только для себя и меняет подпись', async () => {
    groupRow();
    renderCard();
    const person = userEvent.setup();

    const button = await screen.findByRole('button', { name: 'Показывать «Аренда»' });
    expect(button).toHaveTextContent('Виден');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await person.click(button);

    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/templates/g/hidden')?.body).toEqual({
        hidden: true,
      }),
    );
  });

  it('скрытый групповой шаблон подписан «Скрыт» и приглушён', async () => {
    templates = [
      template({
        id: 'g',
        scope: 'group',
        name: 'Аренда',
        mine: false,
        editable: false,
        hidden: true,
      }),
    ];
    renderCard();

    const button = await screen.findByRole('button', { name: 'Показывать «Аренда»' });
    expect(button).toHaveTextContent('Скрыт');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Аренда').closest('li')!.querySelector('.opacity-60')).not.toBeNull();
  });

  it('порядок с клавиатуры: пробел, стрелка вниз, пробел шлёт новый порядок личных шаблонов', async () => {
    templates = [template({ id: 'a', name: 'Первый' }), template({ id: 'b', name: 'Второй' })];
    renderCard();
    const person = userEvent.setup();

    const handle = await screen.findByRole('button', { name: 'Переместить шаблон: Первый' });
    handle.focus();
    await person.keyboard(' ');
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    await person.keyboard('{ArrowDown}');
    expect(screen.getByRole('status')).toHaveTextContent('Шаблон «Первый»: позиция 2 из 2');
    await person.keyboard(' ');

    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/templates/order')?.body).toEqual({
        ids: ['b', 'a'],
      }),
    );
  });

  it('Escape отменяет перемещение: порядок не отправляется', async () => {
    templates = [template({ id: 'a', name: 'Первый' }), template({ id: 'b', name: 'Второй' })];
    renderCard();
    const person = userEvent.setup();

    const handle = await screen.findByRole('button', { name: 'Переместить шаблон: Первый' });
    handle.focus();
    await person.keyboard(' {ArrowDown}{Escape}');

    expect(handle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Перемещение отменено');
    expect(calls.some((c) => c.url === '/api/templates/order')).toBe(false);
  });

  it('в меню «⋯» нет пунктов «Выше» и «Ниже»', async () => {
    templates = [template({ id: 'a', name: 'Первый' }), template({ id: 'b', name: 'Второй' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Первый' }));

    expect(screen.queryByRole('menuitem', { name: 'Выше' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Ниже' })).toBeNull();
  });

  it('удаление спрашивает подтверждение', async () => {
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Первый' }));
    await person.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await person.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/templates/a')).toBe(true),
    );
  });

  it('участник предлагает личный шаблон группе: уходит запрос на предложение', async () => {
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Первый' }));
    await person.click(screen.getByRole('menuitem', { name: 'Предложить группе' }));
    // Nothing is sent before the person confirms
    expect(calls.some((c) => c.url === '/api/templates/a/share')).toBe(false);
    const dialog = within(screen.getByRole('dialog', { name: 'Предложить группе?' }));
    expect(
      dialog.getByText('Предложить «Первый» группе? Владелец группы решит, включить ли шаблон'),
    ).toBeInTheDocument();
    await person.click(dialog.getByRole('button', { name: 'Предложить' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/templates/a/share')).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Предложение отправлено владельцу')).toBeInTheDocument();
  });

  it('отмена подтверждения ничего не отправляет и тоста нет', async () => {
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Первый' }));
    await person.click(screen.getByRole('menuitem', { name: 'Предложить группе' }));
    await person.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));

    expect(calls.some((c) => c.url === '/api/templates/a/share')).toBe(false);
    expect(screen.queryByText('Предложение отправлено владельцу')).toBeNull();
  });

  it('владелец: «Опубликовать в группе» спрашивает подтверждение, после успеха тост', async () => {
    role = 'owner';
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Первый' }));
    await person.click(screen.getByRole('menuitem', { name: 'Опубликовать в группе' }));
    expect(calls.some((c) => c.url === '/api/templates/a/share')).toBe(false);
    const dialog = within(screen.getByRole('dialog', { name: 'Опубликовать в группе?' }));
    expect(
      dialog.getByText(
        'Опубликовать «Первый» для всей группы? Её увидят все участники, а изменить её сможете вы и автор',
      ),
    ).toBeInTheDocument();
    await person.click(dialog.getByRole('button', { name: 'Опубликовать' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/templates/a/share')).toBe(true));
    expect(await screen.findByText('Шаблон опубликован в группе')).toBeInTheDocument();
  });

  it('владелец публикует свой шаблон в группе, а уже отправленный шаблон не предлагается снова', async () => {
    role = 'owner';
    templates = [
      template({ id: 'a', name: 'Первый' }),
      template({ id: 'b', name: 'Второй', sharedStatus: 'proposed' }),
    ];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Первый' }));
    expect(screen.getByRole('menuitem', { name: 'Опубликовать в группе' })).toBeInTheDocument();
    await person.keyboard('{Escape}');
    await person.click(screen.getByRole('button', { name: 'Действия: Второй' }));

    expect(screen.queryByRole('menuitem', { name: /группе/ })).toBeNull();
    expect(screen.getByText(/предложен группе/)).toBeInTheDocument();
  });

  it('автор предложения: «Изменить» и «Отозвать», но не «Включить для группы»', async () => {
    templates = [
      template({
        id: 'p',
        scope: 'group',
        pending: true,
        name: 'Автобус',
        mine: true,
        editable: true,
      }),
    ];
    renderCard();
    const person = userEvent.setup();

    expect(
      await screen.findByRole('heading', { name: 'Ждут решения владельца' }),
    ).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Действия: Автобус' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Изменить',
      'Отозвать',
    ]);
  });

  it('включённый групповой шаблон участник не меняет: меню нет, только кнопка показа', async () => {
    templates = [
      template({ id: 'g', scope: 'group', name: 'Автобус', mine: true, editable: false }),
    ];
    renderCard();

    expect(await screen.findByRole('button', { name: 'Показывать «Автобус»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Действия: Автобус' })).toBeNull();
  });

  it('предложение не попадает в полоску над формой', async () => {
    templates = [template({ id: 'p', scope: 'group', pending: true, name: 'Автобус' })];
    await renderPage();

    await waitFor(() => expect(calls.some((c) => c.url === '/api/templates')).toBe(true));
    expect(screen.queryByRole('group', { name: 'Быстрые траты' })).toBeNull();
  });
});

describe('дубли личного и группового шаблона', () => {
  const personalCopy = (patch: Partial<Template> = {}) =>
    template({ id: 'p', name: 'Sorriso', sharedStatus: 'active', ...patch });
  const groupCopy = (patch: Partial<Template> = {}) =>
    template({ id: 'g', scope: 'group', name: 'Sorriso', mine: false, editable: false, ...patch });
  const strip = () => screen.getByRole('group', { name: 'Быстрые траты' });

  it('личный шаблон с активной групповой копией не предлагается отдельно: один чип', async () => {
    templates = [personalCopy(), groupCopy()];
    await renderPage();

    await waitFor(() => expect(within(strip()).getAllByText(/Sorriso/)).toHaveLength(1));
    expect(within(strip()).getAllByText(/Sorriso/)).toHaveLength(1);
  });

  it('в панели «Все» тоже один «Sorriso» (в группе, не среди «Моих»)', async () => {
    templates = [personalCopy(), groupCopy()];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: 'Все' }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getAllByText(/Sorriso/)).toHaveLength(1);
  });

  it('копия скрыта пользователем: личный шаблон возвращается', async () => {
    templates = [personalCopy(), groupCopy({ hidden: true })];
    await renderPage();

    await waitFor(() => expect(within(strip()).getAllByText(/Sorriso/)).toHaveLength(1));
  });

  it('«скрыть все групповые»: личный шаблон предлагается', async () => {
    preferences = { 'templates.hideGroup': true };
    templates = [personalCopy(), groupCopy()];
    await renderPage();

    await waitFor(() => expect(within(strip()).getAllByText(/Sorriso/)).toHaveLength(1));
    expect(
      within(strip())
        .queryByText(/Sorriso/)!
        .closest('button'),
    ).not.toBeNull();
  });

  it('другая копия (другая сумма) — это другой шаблон, оба видны', async () => {
    templates = [personalCopy(), groupCopy({ amount: 999 })];
    await renderPage();

    await waitFor(() => expect(within(strip()).getAllByText(/Sorriso/)).toHaveLength(2));
  });

  it('личный шаблон без активной копии (предложен) остаётся', async () => {
    templates = [personalCopy({ sharedStatus: 'proposed' })];
    await renderPage();

    await waitFor(() => expect(within(strip()).getAllByText(/Sorriso/)).toHaveLength(1));
  });

  it('в настройках оба ряда на месте, у личного пометка «есть в группе»', async () => {
    templates = [personalCopy(), groupCopy()];
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText(/Sorriso/)).toHaveLength(2);
    expect(screen.getByText(/есть в группе/)).toBeInTheDocument();
  });
});

describe('правка группового шаблона и меню по ролям', () => {
  const renderCard = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const group = (patch: Partial<Template> = {}) =>
    template({ id: 'g', scope: 'group', name: 'Автобус', mine: false, ...patch });
  const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

  it('нажатие на название открывает окно правки, когда шаблон можно править', async () => {
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Изменить шаблон: Первый' }));

    expect(await screen.findByRole('dialog', { name: 'Изменить шаблон' })).toBeInTheDocument();
  });

  it('шаблон, который править нельзя, не нажимается и «⋯» у него нет', async () => {
    templates = [group({ editable: false })];
    renderCard();

    expect(await screen.findByText('Автобус')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Изменить шаблон: Автобус' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Действия: Автобус' })).toBeNull();
  });

  it('групповой шаблон: автор-участник правит и удаляет, но порядок меняет только владелец', async () => {
    templates = [
      group({ editable: true, mine: true }),
      group({ id: 'g2', name: 'Метро', editable: true, mine: true }),
    ];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Автобус' }));

    expect(menuItems()).toEqual(['Изменить', 'Удалить']);
  });

  it('групповой шаблон: владелец — «Изменить», «Удалить»', async () => {
    role = 'owner';
    templates = [group({ editable: true }), group({ id: 'g2', name: 'Метро', editable: true })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Действия: Автобус' }));

    expect(menuItems()).toEqual(['Изменить', 'Удалить']);
  });

  it('предложение чужого участника, которое владелец не правит: нет «⋯»', async () => {
    templates = [group({ pending: true, editable: false })];
    renderCard();

    expect(await screen.findByText(/Автобус/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Действия: Автобус' })).toBeNull();
  });

  it('в окне правки группового шаблона подпись «изменения увидит вся группа», у личного её нет', async () => {
    role = 'owner';
    templates = [group({ editable: true }), template({ id: 'a', name: 'Личный' })];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Изменить шаблон: Автобус' }));
    expect(screen.getByText('Групповой шаблон: изменения увидит вся группа')).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Отмена' }));
    await person.click(screen.getByRole('button', { name: 'Изменить шаблон: Личный' }));

    expect(screen.queryByText(/изменения увидит вся группа/)).toBeNull();
  });
});

describe('выбор эмодзи', () => {
  const openDialog = async () => {
    templates = [template({ id: 'a', name: 'Первый' })];
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const person = userEvent.setup();
    await person.click(await screen.findByRole('button', { name: 'Изменить шаблон: Первый' }));
    await screen.findByRole('dialog', { name: 'Изменить шаблон' });
    return person;
  };
  const putBody = () => calls.find((c) => c.method === 'PUT' && c.url === '/api/templates/a')?.body;

  it('без эмодзи на кнопке «Выбрать»; сетка скрыта, пока не открыли', async () => {
    await openDialog();

    expect(screen.getByRole('button', { name: 'Выбрать эмодзи' })).toHaveTextContent('Выбрать');
    expect(screen.queryByRole('group', { name: 'Эмодзи' })).toBeNull();
  });

  it('сетка из 8 колонок, у каждой кнопки aria-label; тап выбирает и закрывает сетку', async () => {
    const person = await openDialog();
    await person.click(screen.getByRole('button', { name: 'Выбрать эмодзи' }));

    const grid = within(screen.getByRole('group', { name: 'Эмодзи' }));
    expect(grid.getByRole('button', { name: '🛒' }).parentElement!.className).toContain(
      'grid-cols-8',
    );
    expect(EMOJIS.length).toBeGreaterThanOrEqual(56);
    await person.click(grid.getByRole('button', { name: '🍕' }));

    expect(screen.queryByRole('group', { name: 'Эмодзи' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Эмодзи: 🍕. Изменить' })).toHaveTextContent('🍕');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(putBody()).toMatchObject({ emoji: '🍕' }));
  });

  it('выбранный эмодзи отмечен в сетке (aria-pressed)', async () => {
    templates = [template({ id: 'a', name: 'Первый', emoji: '☕' })];
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const person = userEvent.setup();
    await person.click(await screen.findByRole('button', { name: 'Изменить шаблон: Первый' }));

    await person.click(await screen.findByRole('button', { name: 'Эмодзи: ☕. Изменить' }));

    expect(screen.getByRole('button', { name: '☕' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '🛒' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('«Без эмодзи» очищает выбор', async () => {
    const person = await openDialog();
    await person.click(screen.getByRole('button', { name: 'Выбрать эмодзи' }));
    await person.click(screen.getByRole('button', { name: '🛒' }));
    await person.click(screen.getByRole('button', { name: 'Эмодзи: 🛒. Изменить' }));

    await person.click(screen.getByRole('button', { name: 'Без эмодзи' }));

    expect(screen.getByRole('button', { name: 'Выбрать эмодзи' })).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(putBody()).toMatchObject({ emoji: null }));
  });

  it('любой эмодзи можно вписать или вставить в маленькое поле', async () => {
    const person = await openDialog();
    await person.click(screen.getByRole('button', { name: 'Выбрать эмодзи' }));

    await person.type(screen.getByLabelText('Свой эмодзи'), '🦊');

    expect(screen.getByLabelText('Свой эмодзи')).toHaveValue('🦊');
    await person.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(putBody()).toMatchObject({ emoji: '🦊' }));
  });
});

describe('автор и предложения в личных настройках', () => {
  const renderCard = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('у группового шаблона во второй строке автор, у своего «ваш шаблон»', async () => {
    templates = [
      template({
        id: 'g1',
        scope: 'group',
        name: 'Кафе',
        mine: false,
        author: 'Настя',
        editable: false,
      }),
      template({ id: 'g2', scope: 'group', name: 'Метро', mine: true, author: 'Миша' }),
    ];
    renderCard();

    expect(await screen.findByText('Автор: Настя')).toBeInTheDocument();
    expect(screen.getByText('ваш шаблон')).toBeInTheDocument();
  });

  it('кто и когда изменил: чужой редактор, тот же автор, вы сами, не менялся', async () => {
    templates = [
      template({
        id: 'a',
        scope: 'group',
        name: 'А',
        mine: false,
        editable: false,
        author: 'Настя',
        updatedBy: 'Петя',
        updatedAt: '2026-10-17T10:00:00Z',
      }),
      template({
        id: 'b',
        scope: 'group',
        name: 'Б',
        mine: false,
        editable: false,
        author: 'Настя',
        updatedBy: 'Настя',
        updatedAt: '2026-10-17T10:00:00Z',
      }),
      template({
        id: 'c',
        scope: 'group',
        name: 'В',
        mine: false,
        editable: false,
        author: 'Настя',
        updatedBy: 'Петя',
        updatedAt: '2025-03-02T10:00:00Z',
      }),
      template({
        id: 'd',
        scope: 'group',
        name: 'Г',
        mine: false,
        editable: false,
        author: 'Петя',
      }),
    ];
    renderCard();

    expect(await screen.findByText('Автор: Настя · изменил Петя, 17 окт.')).toBeInTheDocument();
    expect(screen.getByText('Автор: Настя · изменён 17 окт.')).toBeInTheDocument();
    expect(screen.getByText('Автор: Настя · изменил Петя, 2 мар. 2025')).toBeInTheDocument();
    expect(screen.getByText('Автор: Петя')).toBeInTheDocument();
  });

  it('если последним менял текущий пользователь: «изменили вы»', async () => {
    templates = [
      template({
        id: 'a',
        scope: 'group',
        name: 'А',
        mine: false,
        editable: false,
        author: 'Настя',
        updatedBy: USER.displayName,
        updatedAt: '2026-10-17T10:00:00Z',
      }),
    ];
    renderCard();

    expect(await screen.findByText('Автор: Настя · изменили вы, 17 окт.')).toBeInTheDocument();
  });

  it('в окне правки группового шаблона подпись «Изменил Петя, 17 окт.»', async () => {
    role = 'owner';
    templates = [
      template({
        id: 'a',
        scope: 'group',
        name: 'А',
        mine: false,
        author: 'Настя',
        updatedBy: 'Петя',
        updatedAt: '2026-10-17T10:00:00Z',
      }),
    ];
    renderCard();
    const person = userEvent.setup();

    await person.click(await screen.findByRole('button', { name: 'Изменить шаблон: А' }));

    expect(screen.getByText(/Изменил Петя, 17 окт\./)).toBeInTheDocument();
  });

  it('владельцу вместо списка предложений ссылка на «Группа»', async () => {
    role = 'owner';
    templates = [
      template({
        id: 'p1',
        scope: 'group',
        pending: true,
        mine: false,
        author: 'Настя',
        name: 'Кофе',
      }),
      template({
        id: 'p2',
        scope: 'group',
        pending: true,
        mine: false,
        author: 'Петя',
        name: 'Метро',
      }),
    ];
    renderCard();

    const link = await screen.findByRole('link', { name: '2 предложения ждут решения → Группа' });
    expect(link).toHaveAttribute('href', '/group');
    expect(screen.queryByText('Кофе')).toBeNull();
  });

  it('владельцу без предложений ссылки нет', async () => {
    role = 'owner';
    templates = [template({ id: 'a', name: 'Первый' })];
    renderCard();

    await screen.findByText('Первый');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('участник видит свои ожидающие предложения как раньше', async () => {
    templates = [
      template({
        id: 'p1',
        scope: 'group',
        pending: true,
        mine: true,
        name: 'Кофе',
        author: 'Миша',
      }),
    ];
    renderCard();

    expect(await screen.findByText('Ждут решения владельца')).toBeInTheDocument();
    expect(screen.getByText(/ждёт решения владельца/)).toBeInTheDocument();
  });
});

describe('порядок и приоритет в настройках', () => {
  const EXPLAIN =
    'Порядок ваш: перетащите шаблон, чтобы поменять. По умолчанию сверху шаблоны группы, а новые групповые встают наверх';
  const renderCard = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <TemplatesCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const g = (id: string, name: string, patch: Partial<Template> = {}) =>
    template({
      id,
      scope: 'group',
      name,
      mine: false,
      editable: false,
      category: 'кафе',
      ...patch,
    });
  const p = (id: string, name: string, patch: Partial<Template> = {}) =>
    template({ id, name, ...patch });
  const texts = () =>
    [...screen.getByText(EXPLAIN).parentElement!.querySelectorAll('li')].map(
      (item) => item.textContent ?? '',
    );
  const names = () =>
    texts().map(
      (row) =>
        row.match(/Групповой\d|Личный\d|Над формой|Только в списке «Все»|Не показываются/)?.[0],
    );
  const orderBody = () => calls.find((c) => c.url === '/api/templates/order')?.body;

  it('под описанием строка про личный порядок', async () => {
    templates = [p('a', 'Первый')];
    renderCard();

    expect(await screen.findByText(EXPLAIN)).toBeInTheDocument();
  });

  it('один общий список в порядке сервера: группа и личные вперемешку, пометка «Группа», разделитель после трёх', async () => {
    templates = [
      p('a', 'Личный1'),
      g('g1', 'Групповой1'),
      p('b', 'Личный2'),
      g('g2', 'Групповой2'),
      p('c', 'Личный3'),
    ];
    renderCard();

    await screen.findByText('Групповой1');
    expect(names()).toEqual([
      'Над формой',
      'Личный1',
      'Групповой1',
      'Личный2',
      'Только в списке «Все»',
      'Групповой2',
      'Личный3',
    ]);
    expect(screen.getAllByText('Группа')).toHaveLength(2);
  });

  it('скрытые и с архивной категорией уходят в «Не показываются» с причиной', async () => {
    templates = [
      g('g1', 'Групповой1', { hidden: true }),
      p('a', 'Личный1', { unavailable: true }),
      p('b', 'Личный2'),
    ];
    renderCard();

    await screen.findByText('Личный2');
    const rows = texts();
    expect(rows.indexOf('Не показываются')).toBeGreaterThan(
      rows.findIndex((row) => row.includes('Личный2')),
    );
    expect(screen.getByText('категория в архиве')).toBeInTheDocument();
    const tail = rows.slice(rows.indexOf('Не показываются') + 1).join('|');
    expect(tail).toContain('Групповой1');
    expect(tail).toContain('Личный1');
    expect(tail).toContain('Скрыт');
  });

  it('копия в группе заменяет личный шаблон: он в «Не показываются» с причиной', async () => {
    templates = [g('g1', 'Sorriso'), p('a', 'Sorriso', { sharedStatus: 'active' })];
    renderCard();

    expect(await screen.findByText('заменён групповым')).toBeInTheDocument();
  });

  it('полоска выключена: подпись про значок и без разделителя «Только в списке «Все»»', async () => {
    preferences = { 'templates.strip': false };
    templates = [p('a', 'Один'), p('b', 'Два'), p('c', 'Три'), p('d', 'Четыре')];
    renderCard();

    expect(await screen.findByText('В списке «Быстрые траты» (значок ⚡)')).toBeInTheDocument();
    expect(screen.queryByText('Над формой')).toBeNull();
    expect(screen.queryByText('Только в списке «Все»')).toBeNull();
  });

  it('ручка есть у каждой показанной строки, в том числе у групповых, даже для участника', async () => {
    templates = [g('g1', 'Групповой1'), p('a', 'Личный1')];
    renderCard();

    await screen.findByText('Личный1');
    expect(screen.getByRole('button', { name: 'Переместить шаблон: Личный1' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Переместить шаблон: Групповой1' }),
    ).toBeInTheDocument();
  });

  it('личный шаблон можно поднять выше группового; разделитель следует за новым порядком', async () => {
    templates = [
      g('g1', 'Групповой1'),
      g('g2', 'Групповой2'),
      g('g3', 'Групповой3'),
      p('a', 'Личный1'),
    ];
    renderCard();
    const person = userEvent.setup();

    const handle = await screen.findByRole('button', { name: 'Переместить шаблон: Личный1' });
    handle.focus();
    await person.keyboard(' {ArrowUp}{ArrowUp}{ArrowUp}');
    expect(names()).toEqual([
      'Над формой',
      'Личный1',
      'Групповой1',
      'Групповой2',
      'Только в списке «Все»',
      'Групповой3',
    ]);
    await person.keyboard(' ');

    await waitFor(() => expect(orderBody()).toEqual({ ids: ['a', 'g1', 'g2', 'g3'] }));
  });

  it('порядок шлётся целиком, скрытые остаются на своих местах', async () => {
    templates = [p('a', 'Личный1'), g('g1', 'Групповой1', { hidden: true }), p('b', 'Личный2')];
    renderCard();
    const person = userEvent.setup();

    const handle = await screen.findByRole('button', { name: 'Переместить шаблон: Личный1' });
    handle.focus();
    await person.keyboard(' {ArrowDown} ');

    await waitFor(() => expect(orderBody()).toEqual({ ids: ['b', 'g1', 'a'] }));
  });

  it('ошибка сохранения: порядок возвращается и виден текст ошибки', async () => {
    orderFails = true;
    templates = [p('a', 'Личный1'), p('b', 'Личный2')];
    renderCard();
    const person = userEvent.setup();

    const handle = await screen.findByRole('button', { name: 'Переместить шаблон: Личный1' });
    handle.focus();
    await person.keyboard(' {ArrowDown} ');

    expect(await screen.findByText('Не удалось сохранить порядок')).toBeInTheDocument();
    await waitFor(() => expect(names().slice(1)).toEqual(['Личный1', 'Личный2']));
  });
});

describe('полоска над формой: горизонтальная прокрутка', () => {
  it('чипы не сжимаются и не переносятся, «Все» закреплена справа вне прокручиваемой части', async () => {
    templates = [template({ id: 'a', name: 'Кофе' }), template({ id: 'b', name: 'Sorriso' })];
    await renderPage();

    const strip = await screen.findByRole('group', { name: 'Быстрые траты' });
    const chip = within(strip).getByRole('button', { name: /Кофе/ });
    expect(chip.className).toContain('shrink-0');
    expect(chip.className).toContain('whitespace-nowrap');
    const scroller = chip.parentElement!;
    expect(scroller.className).toContain('overflow-x-auto');
    expect(within(strip).getByRole('button', { name: 'Все' }).parentElement).toBe(strip);
    expect(strip.contains(scroller)).toBe(true);
    expect(scroller.contains(within(strip).getByRole('button', { name: 'Все' }))).toBe(false);
  });

  it('в полоске не больше трёх чипов; затухания у края нет, пока всё помещается', async () => {
    templates = ['a', 'b', 'c', 'd'].map((id) => template({ id, name: `Ш${id}` }));
    await renderPage();

    const strip = await screen.findByRole('group', { name: 'Быстрые траты' });
    expect(within(strip).getAllByRole('button')).toHaveLength(4);
    expect(within(strip).queryByTestId('strip-fade')).toBeNull();
  });
});

describe('шаблон поверх формы: форма ничего не запрещает', () => {
  const nameField = () => screen.getByLabelText('Наименование');
  const amountField = () => screen.getByLabelText('Стоимость');
  const withAmount = (patch: Partial<Template> = {}) =>
    template({
      id: 'a',
      name: 'Кофе',
      expenseName: 'Кофе',
      category: 'кафе',
      amount: 1200,
      ...patch,
    });
  const noAmount = () =>
    template({
      id: 'b',
      name: 'Магазин',
      expenseName: 'Продукты',
      category: 'продукты',
      amount: null,
      currency: null,
    });

  it('форма заполнена: шаблон с суммой всё равно создаёт расход, форма не тронута, тоста про поля нет', async () => {
    templates = [withAmount()];
    const person = await renderPage();
    await person.type(nameField(), 'Мой текст');
    await person.type(amountField(), '777');

    await person.click(await screen.findByRole('button', { name: /Кофе/ }));

    await screen.findByText(/Добавлено · Кофе/);
    expect(posted()).toHaveLength(1);
    expect(nameField()).toHaveValue('Мой текст');
    expect(amountField()).toHaveValue('777');
    expect(screen.queryByText(/пустые поля|Поля уже заполнены/)).toBeNull();
  });

  it('шаблон без суммы заменяет название и категорию, но оставляет набранную сумму', async () => {
    templates = [noAmount()];
    const person = await renderPage();
    await person.type(nameField(), 'Мой текст');
    await person.type(amountField(), '777');

    await person.click(await screen.findByRole('button', { name: 'Магазин' }));

    await waitFor(() => expect(nameField()).toHaveValue('Продукты'));
    expect(amountField()).toHaveValue('777');
    expect(screen.getByLabelText('Категория')).toHaveValue('продукты');
    expect(posted()).toHaveLength(0);
  });

  it('несколько шаблонов подряд: второй «В форму» заменяет первый, потом «Добавить» создаёт расход', async () => {
    templates = [
      withAmount(),
      withAmount({
        id: 'c',
        name: 'Метро',
        expenseName: 'Метро',
        category: 'продукты',
        amount: 300,
      }),
    ];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Все/ }));
    await person.click(await screen.findByRole('button', { name: 'Кофе: открыть в форме' }));
    await waitFor(() => expect(nameField()).toHaveValue('Кофе'));
    expect(amountField()).toHaveValue('1 200');

    await person.click(await screen.findByRole('button', { name: /Все/ }));
    await person.click(await screen.findByRole('button', { name: 'Метро: открыть в форме' }));
    await waitFor(() => expect(nameField()).toHaveValue('Метро'));
    expect(amountField()).toHaveValue('300');
    expect(posted()).toHaveLength(0);

    await person.click(await screen.findByRole('button', { name: /Все/ }));
    await person.click(await screen.findByRole('button', { name: 'Кофе: добавить сразу' }));
    await screen.findByText(/Добавлено · Кофе/);
    expect(posted()).toHaveLength(1);
    expect(nameField()).toHaveValue('Метро');
  });

  it('в панели у шаблона с суммой две кнопки, у шаблона без суммы только нажатие', async () => {
    templates = [withAmount(), noAmount()];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Все/ }));

    expect(screen.getByRole('button', { name: 'Кофе: добавить сразу' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Кофе: открыть в форме' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Магазин: добавить сразу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Магазин: открыть в форме' })).toBeNull();
  });

  it('чипы можно нажимать один за другим: создание после заполнения и заполнение после заполнения', async () => {
    templates = [withAmount(), noAmount()];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: 'Магазин' }));
    await waitFor(() => expect(nameField()).toHaveValue('Продукты'));
    await person.click(screen.getByRole('button', { name: /Кофе/ }));
    await screen.findByText(/Добавлено · Кофе/);
    await person.click(screen.getByRole('button', { name: 'Магазин' }));

    expect(posted()).toHaveLength(1);
    expect(nameField()).toHaveValue('Продукты');
  });
});

describe('панель «Быстрые траты»: порядок как у полоски', () => {
  it('порядок строк тот же, что прислал сервер: групповой шаблон не уезжает в конец', async () => {
    templates = [
      template({ id: 'a', name: 'Такси' }),
      template({ id: 'g', scope: 'group', name: 'Аренда', mine: false, editable: false }),
      template({ id: 'b', name: 'Кофе' }),
    ];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Все/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Быстрые траты' }));

    const order = dialog
      .getAllByRole('listitem')
      .map((item) => item.textContent?.match(/Такси|Аренда|Кофе/)?.[0]);
    expect(order).toEqual(['Такси', 'Аренда', 'Кофе']);
  });
});

describe('у пользователя нет подходящей карты (effectiveCard = null)', () => {
  const NO_CARD =
    'Карта не выбрана: проверьте карту в форме. Выбрать карту по умолчанию можно в «Настройки»';
  const noCard = () =>
    template({
      id: 'a',
      name: 'Автобус',
      expenseName: 'Автобус',
      amount: 150,
      effectiveCard: null,
    });

  it('тап по шаблону с суммой не создаёт расход: заполняет форму и показывает подсказку', async () => {
    templates = [noCard()];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Автобус/ }));

    expect(await screen.findByText(NO_CARD)).toBeInTheDocument();
    expect(posted()).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('Наименование')).toHaveValue('Автобус'));
    expect(screen.getByLabelText('Стоимость')).toHaveValue('150');
  });

  it('«Добавить» в панели делает то же самое', async () => {
    templates = [noCard()];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Все/ }));
    await person.click(await screen.findByRole('button', { name: 'Автобус: добавить сразу' }));

    expect(await screen.findByText(NO_CARD)).toBeInTheDocument();
    expect(posted()).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('Наименование')).toHaveValue('Автобус'));
  });

  it('с картой шаблон по-прежнему создаёт расход, подсказки нет', async () => {
    templates = [noCard()];
    templates[0] = { ...templates[0]!, effectiveCard: 'Миша' };
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Автобус/ }));

    await screen.findByText(/Добавлено · Автобус/);
    expect(screen.queryByText(NO_CARD)).toBeNull();
  });

  it('ошибка INVALID_CARD при создании по шаблону объясняется понятным текстом', async () => {
    createFailsWithCard = true;
    templates = [template({ id: 'a', name: 'Автобус', amount: 150, effectiveCard: 'Старая' })];
    const person = await renderPage();

    await person.click(await screen.findByRole('button', { name: /Автобус/ }));

    expect(
      await screen.findByText(
        'Не удалось определить карту. Укажите карту по умолчанию в «Настройки» или выберите её в форме',
      ),
    ).toBeInTheDocument();
  });
});
