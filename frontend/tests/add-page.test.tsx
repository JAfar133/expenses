import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetSummary } from '../src/features/budgets/components/BudgetSummary.tsx';
import { projectBudget } from '../src/features/budgets/model/projection.ts';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';
import { knownFlag } from '../src/shared/utils/currency-flags.ts';
import { caretAfterFormat } from '../src/shared/utils/money.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json(status, { success: true, data });

const budget = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  categoryId: null,
  category: null,
  limit: 20000,
  periodKind: 'month',
  periodDay: null,
  period: { from: '2026-10-01', to: '2026-10-31' },
  spent: 12500,
  remaining: 7500,
  percent: 62.5,
  level: 'ok',
  currency: 'AMD',
  ...overrides,
});
const category = (id: string, name: string, overrides: Record<string, unknown> = {}) =>
  budget({
    id,
    categoryId: id,
    category: name,
    limit: 1000,
    spent: 100,
    remaining: 900,
    percent: 10,
    ...overrides,
  });

const USER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: false,
  role: 'member' as const,
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};

let budgets: unknown[];
let cards: { name: string; currency: string }[];
let suggestions: { name: string; category: string; count: number }[];
let rates: { currency: string; rate: number; fetchedAt: string }[];
let posted: Record<string, unknown>[];
let requests: string[];

beforeEach(() => {
  budgets = [];
  cards = [
    { name: 'Миша', currency: 'AMD' },
    { name: 'Доллары', currency: 'USD' },
  ];
  suggestions = [];
  rates = [{ currency: 'USD', rate: 400, fetchedAt: '2026-10-10T10:00:00.000Z' }];
  posted = [];
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url === '/api/cards') return ok(cards);
      if (url === '/api/categories') return ok(['кафе', 'продукты']);
      if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
      if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD', 'USD'], rates });
      if (url === '/api/name-suggestions') return ok(suggestions);
      if (url === '/api/budgets') return ok(budgets);
      if (url === '/api/receipts/settings') return ok({ enabled: false, categories: [] });
      if (url.startsWith('/api/analytics/')) throw new Error('no analytics');
      if (url === '/api/expenses') {
        const body = JSON.parse(String(init?.body));
        posted.push(body);
        return ok({ id: '1', excelStatus: 'synced', ...body, original: null }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
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

describe('выбор карты', () => {
  const options = () =>
    within(screen.getByLabelText('Карта'))
      .getAllByRole('option')
      .map((option) => option.textContent);

  it('одно поле «Карта»: флаг, название и код валюты; выбранная показана в поле', async () => {
    const person = await renderPage();

    const select = screen.getByLabelText('Карта');
    expect(select.tagName).toBe('SELECT');
    expect(options()).toEqual(['🇦🇲 Миша · AMD', '🇺🇸 Доллары · USD']);
    expect(select).toHaveValue('Миша');
    expect(screen.queryByRole('radio', { name: /Миша/ })).toBeNull();

    await person.selectOptions(select, 'Доллары');
    expect(select).toHaveValue('Доллары');
    // Choosing a card still switches the currency of the expense
    expect(screen.getByLabelText('Валюта')).toHaveValue('USD');
  });

  it('у неизвестной валюты в строке только код, без флага', async () => {
    cards = [
      { name: 'Миша', currency: 'AMD' },
      { name: 'Экзотика', currency: 'XYZ' },
    ];
    await renderPage();

    expect(options()).toEqual(['🇦🇲 Миша · AMD', 'Экзотика · XYZ']);
  });

  it('одна карта: выбора нет, карта показана текстом и уходит в расход', async () => {
    cards = [{ name: 'Миша', currency: 'AMD' }];
    const person = await renderPage();

    expect(screen.queryByRole('combobox', { name: 'Карта' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Карта' })).toHaveTextContent('🇦🇲 Миша · AMD');
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await person.type(screen.getByLabelText('Стоимость'), '500');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ card: 'Миша', amount: 500 });
  });

  it('поле выбора категории и карты оформлены одинаково: с шевроном', async () => {
    await renderPage();

    for (const name of ['Карта', 'Категория']) {
      const select = screen.getByLabelText(name);
      expect(select).toHaveClass('pr-11');
      expect(select.parentElement?.querySelector('svg')).not.toBeNull();
    }
  });

  it('knownFlag: известные валюты и неизвестная', () => {
    expect(knownFlag('AMD')).toBe('🇦🇲');
    expect(knownFlag('RUB')).toBe('🇷🇺');
    expect(knownFlag('USD')).toBe('🇺🇸');
    expect(knownFlag('EUR')).toBe('🇪🇺');
    expect(knownFlag('XYZ')).toBeUndefined();
  });
});

describe('стоимость', () => {
  it('крупный шрифт, цифры с разделителем тысяч, отправляется чистое число', async () => {
    const person = await renderPage();
    const amount = screen.getByLabelText('Стоимость');
    expect(amount).toHaveClass('text-2xl', 'font-semibold', 'tabular-nums');

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await person.type(amount, '12500');
    expect(amount).toHaveValue('12 500');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ amount: 12500 });
  });

  it('вставка в середину не сбрасывает курсор в конец', async () => {
    const person = await renderPage();
    const amount = screen.getByLabelText('Стоимость') as HTMLInputElement;
    await person.type(amount, '1250');
    expect(amount).toHaveValue('1 250');

    // Put the caret after «1 2» and type a digit
    amount.setSelectionRange(3, 3);
    await person.keyboard('9');

    expect(amount).toHaveValue('12 950');
    expect(amount.selectionStart).toBe(4);
  });

  it('caretAfterFormat: курсор остаётся после тех же цифр', () => {
    expect(caretAfterFormat('12500', 2, '12 500')).toBe(2);
    expect(caretAfterFormat('12500', 3, '12 500')).toBe(4);
    expect(caretAfterFormat('1 2900', 4, '12 900')).toBe(4);
    expect(caretAfterFormat('abc', 3, '')).toBe(0);
  });

  it('валюта с копейками: запятая или точка, не больше двух знаков', async () => {
    const person = await renderPage();
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    const amount = screen.getByLabelText('Стоимость');
    expect(amount).toHaveAttribute('inputmode', 'decimal');

    await person.type(amount, '1234.567');

    expect(amount).toHaveValue('1 234,56');
  });

  it('при выборе карты валюта равна валюте карты и без пометки', async () => {
    const person = await renderPage();
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');

    expect(screen.getByLabelText('Валюта')).toHaveValue('USD');
    expect(screen.queryByText(/валюта отличается/)).toBeNull();
  });

  it('если выбрана другая валюта, рядом нейтральная пометка с валютой карты', async () => {
    const person = await renderPage();
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');

    await person.selectOptions(screen.getByLabelText('Валюта'), 'AMD');

    expect(screen.getByText('валюта отличается от валюты карты (USD)')).toBeInTheDocument();
    await person.selectOptions(screen.getByLabelText('Валюта'), 'USD');
    expect(screen.queryByText(/валюта отличается/)).toBeNull();
  });
});

describe('наименование и подсказки', () => {
  it('подсказки только выбранной категории, в порядке сервера; клик подставляет значение', async () => {
    suggestions = [
      { name: 'Латте', category: 'кафе', count: 9 },
      { name: 'Хлеб', category: 'продукты', count: 7 },
      { name: 'Эспрессо', category: 'кафе', count: 2 },
    ];
    const person = await renderPage();
    expect(screen.queryByRole('group', { name: 'Подсказки наименования' })).toBeNull();

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');

    const group = await screen.findByRole('group', { name: 'Подсказки наименования' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Латте', 'Эспрессо']);
    await person.click(within(group).getByRole('button', { name: 'Эспрессо' }));
    expect(screen.getByLabelText('Наименование')).toHaveValue('Эспрессо');
  });

  it('категория и наименование стоят ближе друг к другу, чем остальные поля', async () => {
    await renderPage();

    const group = screen.getByLabelText('Категория').closest('.space-y-3');
    expect(group).not.toBeNull();
    expect(group).toContainElement(screen.getByLabelText('Наименование'));
  });
});

describe('лимит выбранной категории под полем стоимости', () => {
  const hint = () => screen.queryByRole('group', { name: 'Лимит категории' });

  async function pickCafe(person: Awaited<ReturnType<typeof renderPage>>) {
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
  }

  it('у категории без лимита блока нет', async () => {
    budgets = [category('c1', 'продукты')];
    const person = await renderPage();
    await pickCafe(person);
    await waitFor(() => expect(requests).toContain('/api/budgets'));

    expect(hint()).toBeNull();
  });

  it('с лимитом: «категория · осталось X», полоса и процент; без суммы — текущее состояние', async () => {
    budgets = [category('c1', 'кафе', { limit: 10000, spent: 4000, remaining: 6000, percent: 40 })];
    const person = await renderPage();
    await pickCafe(person);

    const box = within(await screen.findByRole('group', { name: 'Лимит категории' }));
    expect(box.getByText(/кафе ·/)).toHaveTextContent('осталось 6 000 AMD');
    expect(box.getByText('40%')).toBeInTheDocument();
    expect(box.getByRole('progressbar', { name: 'Лимит: кафе' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
  });

  it('вводимая сумма учитывается: остаток и процент меняются', async () => {
    budgets = [category('c1', 'кафе', { limit: 10000, spent: 4000, remaining: 6000, percent: 40 })];
    const person = await renderPage();
    await pickCafe(person);
    await screen.findByRole('group', { name: 'Лимит категории' });

    await person.type(screen.getByLabelText('Стоимость'), '2500');

    const box = within(screen.getByRole('group', { name: 'Лимит категории' }));
    expect(box.getByText(/кафе ·/)).toHaveTextContent('осталось 3 500 AMD');
    expect(box.getByText('65%')).toBeInTheDocument();
    expect(box.queryByRole('status')).toBeNull();
  });

  it('превышение после покупки: спокойное предупреждение, сохранение не блокируется', async () => {
    budgets = [
      category('c1', 'кафе', {
        limit: 10000,
        spent: 9000,
        remaining: 1000,
        percent: 90,
        level: 'warn',
      }),
    ];
    const person = await renderPage();
    await pickCafe(person);
    await person.type(screen.getByLabelText('Наименование'), 'Ужин');
    await person.type(screen.getByLabelText('Стоимость'), '1500');

    expect(
      await screen.findByText('После покупки лимит категории будет превышен на 500 AMD'),
    ).toBeInTheDocument();
    const bar = within(screen.getByRole('group', { name: 'Лимит категории' })).getByRole(
      'progressbar',
      {
        name: 'Лимит: кафе',
      },
    );
    expect(bar.firstElementChild).toHaveClass('bg-red-500');
    const submit = screen.getByRole('button', { name: 'Добавить расход' });
    expect(submit).toBeEnabled();

    await person.click(submit);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ category: 'кафе', amount: 1500 });
  });

  it('сумма в другой валюте пересчитывается по курсу; без курса — только текущее состояние', async () => {
    budgets = [category('c1', 'кафе', { limit: 10000, spent: 4000, remaining: 6000, percent: 40 })];
    const person = await renderPage();
    await pickCafe(person);
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    await screen.findByRole('group', { name: 'Лимит категории' });

    // 5 USD * 400 = 2 000 AMD
    await person.type(screen.getByLabelText('Стоимость'), '5');
    expect(
      within(screen.getByRole('group', { name: 'Лимит категории' })).getByText(/кафе ·/),
    ).toHaveTextContent('осталось 4 000 AMD');
  });

  it('курс недоступен: проекции нет, показано текущее состояние', async () => {
    rates = [];
    budgets = [category('c1', 'кафе', { limit: 10000, spent: 4000, remaining: 6000, percent: 40 })];
    const person = await renderPage();
    await pickCafe(person);
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    await screen.findByRole('group', { name: 'Лимит категории' });

    await person.type(screen.getByLabelText('Стоимость'), '5');

    expect(
      within(screen.getByRole('group', { name: 'Лимит категории' })).getByText(/кафе ·/),
    ).toHaveTextContent('осталось 6 000 AMD');
  });

  it('после добавления траты лимиты запрашиваются заново', async () => {
    budgets = [category('c1', 'кафе')];
    const person = await renderPage();
    await pickCafe(person);
    await screen.findByRole('group', { name: 'Лимит категории' });
    const before = requests.filter((r) => r === '/api/budgets').length;

    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await person.type(screen.getByLabelText('Стоимость'), '300');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() =>
      expect(requests.filter((r) => r === '/api/budgets').length).toBeGreaterThan(before),
    );
  });

  it('projectBudget: уровни как на сервере', () => {
    const base = budget({
      id: 'x',
      categoryId: 'x',
      category: 'кафе',
      limit: 1000,
      spent: 700,
    }) as never;
    expect(projectBudget(base, null)).toMatchObject({ remaining: 300, level: 'ok' });
    expect(projectBudget(base, 100)).toMatchObject({ remaining: 200, percent: 80, level: 'warn' });
    expect(projectBudget(base, 400)).toMatchObject({ remaining: -100, level: 'over' });
  });
});

describe('сводка «Бюджет» под формой', () => {
  const renderSummary = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <BudgetSummary />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const summary = () => screen.findByRole('region', { name: 'Бюджет' });

  it('без лимитов блока нет', async () => {
    const { container } = renderSummary();
    await waitFor(() => expect(requests).toContain('/api/budgets'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(container).toBeEmptyDOMElement();
  });

  it('нет общего лимита и нечем предупреждать (категории в норме): блока нет', async () => {
    budgets = [category('c1', 'кафе')];
    const { container } = renderSummary();
    await waitFor(() => expect(requests).toContain('/api/budgets'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(container).toBeEmptyDOMElement();
  });

  it('только общий лимит: «Бюджет месяца», потрачено / лимит, полоса, процент, остаток, ссылка', async () => {
    budgets = [budget(), category('c1', 'кафе')];
    renderSummary();

    const box = within(await summary());
    expect(box.getByText('Бюджет месяца')).toBeInTheDocument();
    expect(box.getByText('12 500 AMD')).toBeInTheDocument();
    expect(box.getByText(/\/ 20 000 AMD/)).toBeInTheDocument();
    expect(box.getByText('63%')).toBeInTheDocument();
    expect(box.getByText('Осталось 7 500 AMD')).toBeInTheDocument();
    expect(box.getByRole('progressbar', { name: 'Общий лимит' })).toHaveAttribute(
      'aria-valuenow',
      '63',
    );
    expect(box.getByRole('link', { name: 'Все лимиты →' })).toHaveAttribute('href', '/analytics');
    // Categories in order are not listed
    expect(box.queryByText(/[Кк]афе/)).toBeNull();
  });

  it('недельный общий лимит называется «Бюджет недели»; превышение — «Превышение X»', async () => {
    budgets = [
      budget({ periodKind: 'week', spent: 21000, remaining: -1000, percent: 105, level: 'over' }),
    ];
    renderSummary();

    const box = within(await summary());
    expect(box.getByText('Бюджет недели')).toBeInTheDocument();
    expect(box.getByText('Превышение 1 000 AMD')).toBeInTheDocument();
  });

  it('строки предупреждений: значок уровня, название с заглавной, полоса; справа «+перебор» красным или «осталось» серым и процент', async () => {
    budgets = [
      budget(),
      category('a', 'жилье', {
        level: 'warn',
        percent: 88,
        remaining: 40000,
        spent: 280000,
        limit: 320000,
      }),
      category('b', 'одежда', {
        level: 'over',
        percent: 153,
        remaining: -47952,
        spent: 127952,
        limit: 80000,
      }),
      category('c', 'игры'),
    ];
    renderSummary();

    const box = within(await summary());
    const rows = box.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // The exceeded one first
    expect(within(rows[0]!).getByText('Одежда')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('+47 952 AMD')).toHaveClass('text-red-600');
    expect(within(rows[0]!).getByText('153%')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole('progressbar', { name: 'Лимит: одежда' }),
    ).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Жилье')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('осталось 40 000 AMD')).toHaveClass('text-zinc-500');
    expect(within(rows[1]!).getByText('88%')).toBeInTheDocument();
    // The level mark: a red circle with «!» and an amber triangle
    expect(rows[0]!.textContent).toContain('!');
    expect(rows[1]!.querySelector('.text-amber-500 svg')).not.toBeNull();
    expect(box.queryByText(/Игры/)).toBeNull();
    expect(box.queryByText(/и ещё/)).toBeNull();
    expect(box.getByRole('link', { name: 'Все лимиты →' })).toHaveAttribute('href', '/analytics');
  });

  it('больше трёх предупреждений: три строки, ссылка «Все лимиты (N)» с числом остальных', async () => {
    budgets = [
      budget(),
      ...['а', 'б', 'в', 'г', 'д'].map((name, index) =>
        category(`w${index}`, name, { level: 'warn', percent: 85, remaining: 150 }),
      ),
    ];
    renderSummary();

    const box = within(await summary());
    expect(box.getAllByRole('listitem')).toHaveLength(3);
    expect(box.queryByText(/и ещё/)).toBeNull();
    expect(box.getByRole('link', { name: 'Все лимиты (2) →' })).toHaveAttribute(
      'href',
      '/analytics',
    );
  });

  it('ровно три предупреждения: ссылка без числа', async () => {
    budgets = ['а', 'б', 'в'].map((name, index) =>
      category(`w${index}`, name, { level: 'warn', percent: 85, remaining: 150 }),
    );
    renderSummary();

    const box = within(await summary());
    expect(box.getAllByRole('listitem')).toHaveLength(3);
    expect(box.getByRole('link', { name: 'Все лимиты →' })).toBeInTheDocument();
  });

  it('без общего лимита, но с предупреждением: только категории и ссылка', async () => {
    budgets = [category('a', 'кафе', { level: 'over', percent: 120, remaining: -200 })];
    renderSummary();

    const box = within(await summary());
    expect(box.queryByText(/Бюджет месяца/)).toBeNull();
    expect(box.queryByRole('progressbar', { name: 'Общий лимит' })).toBeNull();
    expect(box.getByText('Кафе')).toBeInTheDocument();
    expect(box.getByText('+200 AMD')).toBeInTheDocument();
    expect(box.getByRole('link', { name: 'Все лимиты →' })).toBeInTheDocument();
  });

  it('на странице «Добавить» сводка стоит под формой', async () => {
    budgets = [budget()];
    await renderPage();

    expect(await screen.findByRole('region', { name: 'Бюджет' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Лимиты' })).toBeNull();
  });
});
