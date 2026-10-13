import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetBars } from '../src/features/budgets/components/BudgetBars.tsx';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';
import {
  harness,
  ok as analyticsOk,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);

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

describe('BudgetBars', () => {
  let budgets: unknown[];
  let config: { currency: string; baseCurrency: string };
  let requests: string[];

  beforeEach(() => {
    budgets = [];
    config = { currency: 'AMD', baseCurrency: 'AMD' };
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url);
        if (url === '/api/budgets') return ok(budgets);
        if (url === '/api/config') return ok(config);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderBars = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <BudgetBars />
      </QueryClientProvider>,
    );

  it('без лимитов ничего не рисует', async () => {
    const { container } = renderBars();
    await waitFor(() => expect(requests).toContain('/api/budgets'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container).toBeEmptyDOMElement();
  });

  it('общий лимит подписан «Всего»: процент и остаток, лимит и период в title', async () => {
    budgets = [budget()];
    renderBars();

    const bar = await screen.findByRole('progressbar', { name: 'Лимит: Всего' });
    expect(bar).toHaveAttribute('aria-valuenow', '63');
    const row = bar.closest('li')!;
    expect(row).toHaveTextContent('Всего');
    expect(row).toHaveTextContent(/63%\s*· осталось 7 500 AMD/);
    expect(row).not.toHaveTextContent('12 500');
    expect(row).toHaveAttribute('title', 'лимит 20 000 AMD · 01.10–31.10');
  });

  it('уровни: ok — без значка, warn — значок и янтарная полоска, over — красные полоска и «+N», числа обычным цветом', async () => {
    budgets = [
      budget({
        id: 'a',
        category: 'Еда',
        categoryId: '1',
        level: 'ok',
        percent: 40,
        spent: 4000,
        limit: 10000,
        remaining: 6000,
      }),
      budget({
        id: 'b',
        category: 'Кафе',
        categoryId: '2',
        level: 'warn',
        percent: 85,
        spent: 8500,
        limit: 10000,
        remaining: 1500,
      }),
      budget({
        id: 'c',
        category: 'Игры',
        categoryId: '3',
        level: 'over',
        percent: 112,
        spent: 11200,
        limit: 10000,
        remaining: -1200,
      }),
    ];
    renderBars();
    await screen.findByRole('progressbar', { name: 'Лимит: Игры' });

    const row = (name: string) =>
      screen.getByRole('progressbar', { name: `Лимит: ${name}` }).closest('li')!;
    expect(row('Еда').querySelector('svg')).toBeNull();
    expect(row('Кафе').querySelector('svg')).not.toBeNull();
    expect(row('Кафе').querySelector('.bg-amber-500')).not.toBeNull();
    expect(row('Игры').querySelector('svg')).not.toBeNull();
    expect(row('Игры').querySelector('.bg-red-500')).not.toBeNull();
    expect(within(row('Игры')).getByText('· +1 200 AMD')).toHaveClass('text-red-600');
    // The bar never goes past 100%
    expect(screen.getByRole('progressbar', { name: 'Лимит: Игры' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(row('Еда')).not.toHaveTextContent('+');
  });

  it('валюта отчётности не драммы: копейки', async () => {
    config = { currency: 'USD', baseCurrency: 'AMD' };
    budgets = [budget({ spent: 1250.5, limit: 2000, remaining: 749.5, currency: 'USD' })];
    renderBars();

    const bar = await screen.findByRole('progressbar', { name: 'Лимит: Всего' });
    expect(bar.closest('li')).toHaveTextContent('осталось 749,50 USD');
  });
});

describe('лимиты на странице добавления', () => {
  let budgets: unknown[];
  let requests: string[];

  beforeEach(() => {
    budgets = [];
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(url);
        if (url === '/api/cards') return ok([{ name: 'Миша', currency: 'AMD' }]);
        if (url === '/api/categories') return ok(['кафе']);
        if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
        if (url === '/api/rates') return ok({ base: 'AMD', currencies: ['AMD'], rates: [] });
        if (url === '/api/name-suggestions') return ok([]);
        if (url === '/api/budgets') return ok(budgets);
        if (url.startsWith('/api/analytics/summary')) throw new Error('no summary');
        if (url === '/api/expenses') {
          const body = JSON.parse(String(init?.body));
          return ok({ id: '1', excelStatus: 'synced', ...body, original: null }, 201);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const user = {
    username: 'misha',
    displayName: 'Миша',
    card: 'Миша',
    canEdit: false,
    role: 'member' as const,
    isAdmin: false,
    timezone: 'Asia/Yerevan',
  };

  async function renderPage() {
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

  it('без лимитов полосок нет', async () => {
    await renderPage();
    await waitFor(() => expect(requests).toContain('/api/budgets'));

    expect(screen.queryByRole('region', { name: 'Лимиты' })).toBeNull();
  });

  it('с лимитами полоски под формой; после добавления траты лимиты запрашиваются заново', async () => {
    budgets = [budget()];
    const person = await renderPage();
    expect(await screen.findByRole('progressbar', { name: 'Лимит: Всего' })).toBeInTheDocument();
    const before = requests.filter((r) => r === '/api/budgets').length;

    budgets = [budget({ spent: 13500, percent: 67.5, remaining: 6500 })];
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await person.type(screen.getByLabelText('Стоимость'), '1000');
    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await waitFor(() =>
      expect(requests.filter((r) => r === '/api/budgets').length).toBe(before + 1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('progressbar', { name: 'Лимит: Всего' }).closest('li'),
      ).toHaveTextContent('осталось 6 500 AMD'),
    );
  });
});

describe('лимиты на вкладке «Обзор»', () => {
  setupAnalyticsHarness();

  const categoryCard = () =>
    screen.getByRole('heading', { name: 'Расход по категориям' }).closest('section')!;
  const overall = () => screen.findByRole('region', { name: 'Общий бюджет' });

  it('при валюте показа USD запрос идёт с currency=USD, числа сервера показаны без пересчёта', async () => {
    harness.handlers['/api/rates'] = () =>
      analyticsOk({
        base: 'AMD',
        currencies: ['AMD', 'USD'],
        rates: [{ currency: 'USD', rate: 380, fetchedAt: '2026-10-10T10:00:00.000Z' }],
      });
    harness.handlers['/api/preferences'] = () => analyticsOk({ 'analytics.currency': 'USD' });
    harness.handlers['/api/budgets'] = (url) =>
      analyticsOk([
        url.searchParams.get('currency') === 'USD'
          ? budget({ limit: 100, spent: 40.5, remaining: 59.5, percent: 40.5, currency: 'USD' })
          : budget(),
      ]);
    renderAnalytics();

    const block = within(await overall());
    expect(block.getByText('40,50')).toBeInTheDocument();
    expect(block.getByText(/\/ 100,00 USD/)).toBeInTheDocument();
    expect(block.getByText('41%')).toBeInTheDocument();
    expect(block.getByText('Осталось 59,50 USD до конца периода')).toBeInTheDocument();
    expect(harness.requests).toContain('/api/budgets?currency=USD');
  });

  it('смена валюты показа перезапрашивает лимиты с новой валютой', async () => {
    harness.handlers['/api/rates'] = () =>
      analyticsOk({
        base: 'AMD',
        currencies: ['AMD', 'RUB'],
        rates: [{ currency: 'RUB', rate: 4.5, fetchedAt: '2026-10-10T10:00:00.000Z' }],
      });
    harness.handlers['/api/budgets'] = (url) =>
      analyticsOk([
        url.searchParams.get('currency') === 'RUB'
          ? budget({ limit: 4444, spent: 1000, remaining: 3444, currency: 'RUB' })
          : budget(),
      ]);
    const user = renderAnalytics();
    await overall();
    expect(harness.requests).toContain('/api/budgets?currency=AMD');

    await user.click(await screen.findByRole('radio', { name: /RUB/ }));

    await waitFor(() => expect(harness.requests).toContain('/api/budgets?currency=RUB'));
    expect(
      await within(await overall()).findByText('Осталось 3 444,00 RUB до конца периода'),
    ).toBeInTheDocument();
  });

  it('с лимитами в карточке две вкладки; по умолчанию «Бюджет и лимиты», отдельной карточки нет', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    renderAnalytics();
    await overall();

    const tabs = within(categoryCard()).getByRole('radiogroup', { name: 'Раздел' });
    expect(
      within(tabs)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Бюджет и лимиты', 'Структура расходов']);
    expect(within(tabs).getByRole('radio', { name: 'Бюджет и лимиты' })).toBeChecked();
    expect(categoryCard()).toContainElement(screen.getByRole('region', { name: 'Общий бюджет' }));
    // On the limits tab there is no chart view switch
    expect(within(categoryCard()).queryByRole('radiogroup', { name: 'Вид графика' })).toBeNull();
  });

  it('«Структура расходов»: вкладки выше переключателя видов, ровно три вида; выбор вкладки сохраняется', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    const user = renderAnalytics();
    await overall();

    await user.click(screen.getByRole('radio', { name: 'Структура расходов' }));

    expect(await screen.findByText(/Всего расходов/)).toHaveTextContent('Всего расходов 2 100 AMD');
    const kinds = within(categoryCard()).getByRole('radiogroup', { name: 'Вид графика' });
    const tabs = within(categoryCard()).getByRole('radiogroup', { name: 'Раздел' });
    expect(tabs.compareDocumentPosition(kinds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Separate rows on any width: the tabs fill the row (never inline), the view switch sits in its own block
    expect(tabs).toHaveClass('grid', 'w-full');
    expect(tabs).not.toHaveClass('sm:inline-flex');
    expect(tabs.parentElement).not.toBe(kinds.parentElement);
    expect(tabs.parentElement?.contains(kinds)).toBe(false);
    expect(
      within(kinds)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Полосы', 'Кольцо', 'Круг']);
    expect(screen.queryByRole('region', { name: 'Общий бюджет' })).toBeNull();
    // The choice is saved in the user's settings, like the chart view
    await waitFor(() => {
      const index = harness.requests.findIndex((r) => r === 'PUT /api/preferences');
      expect(harness.bodies[index]).toEqual({ 'category.tab': 'structure' });
    });
  });

  it('сохранённая вкладка «Структура расходов» открывается сразу', async () => {
    harness.handlers['/api/preferences'] = () => analyticsOk({ 'category.tab': 'structure' });
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    renderAnalytics();

    expect(await screen.findByText(/Всего расходов/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Общий бюджет' })).toBeNull();
  });

  it('категории по группам: превышен, близко, остальные, без лимита (свёрнута)', async () => {
    harness.handlers['/api/budgets'] = () =>
      analyticsOk([
        budget(),
        budget({
          id: 'a',
          categoryId: '1',
          category: 'продукты',
          level: 'over',
          percent: 120,
          spent: 1200,
          limit: 1000,
          remaining: -200,
        }),
        budget({
          id: 'b',
          categoryId: '2',
          category: 'Транспорт',
          level: 'warn',
          percent: 85,
          spent: 850,
          limit: 1000,
          remaining: 150,
        }),
        budget({
          id: 'c',
          categoryId: '3',
          category: 'Игры',
          level: 'ok',
          percent: 10,
          spent: 100,
          limit: 1000,
          remaining: 900,
        }),
      ]);
    renderAnalytics();
    await overall();

    const group = (title: string) => screen.getByText(title).closest('details')!;
    expect(within(group('Превышен лимит')).getByText('1 категория')).toBeInTheDocument();
    expect(within(group('Превышен лимит')).getByText('продукты')).toBeInTheDocument();
    expect(within(group('Превышен лимит')).getByText(/превышение 200$/)).toBeInTheDocument();
    expect(within(group('Близко к лимиту')).getByText('Транспорт')).toBeInTheDocument();
    expect(within(group('Близко к лимиту')).getByText(/85%\s*· осталось 150$/)).toBeInTheDocument();
    expect(within(group('Остальные категории')).getByText('Игры')).toBeInTheDocument();
    // Categories with spending but no limit; collapsed by default
    const unlimited = group('Без лимита');
    expect(within(unlimited).getByText('кафе')).toBeInTheDocument();
    expect(unlimited).not.toHaveAttribute('open');
    expect(group('Превышен лимит')).toHaveAttribute('open');
  });

  it('строка категории: числа без кода валюты слева, код валюты отдельно справа, значок и шеврон', async () => {
    harness.handlers['/api/budgets'] = () =>
      analyticsOk([
        budget(),
        budget({
          id: 'a',
          categoryId: '1',
          category: 'продукты',
          level: 'over',
          percent: 120,
          spent: 122398,
          limit: 80000,
          remaining: -42398,
        }),
      ]);
    renderAnalytics();
    await overall();

    const row = screen.getByRole('button', { name: 'продукты: открыть наименования' });
    // Spent and limit without the currency, in one line; the currency code is a separate small text
    expect(within(row).getByText('122 398')).toBeInTheDocument();
    expect(within(row).getByText(/\/ 80 000$/)).toBeInTheDocument();
    expect(within(row).getByText(/превышение 42 398$/)).toHaveClass('text-red-600');
    expect(within(row).getByText('AMD')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('AMD AMD');
    // The round icon (decorative) and the chevron
    expect(row.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    expect(row.querySelector('.bg-red-100')).not.toBeNull();
  });

  it('клик по строке категории открывает её наименования', async () => {
    harness.handlers['/api/budgets'] = () =>
      analyticsOk([
        budget(),
        budget({
          id: 'a',
          categoryId: '1',
          category: 'продукты',
          level: 'ok',
          percent: 10,
          remaining: 900,
        }),
      ]);
    const user = renderAnalytics();
    await overall();

    await user.click(screen.getByRole('button', { name: 'продукты: открыть наименования' }));

    await waitFor(() =>
      expect(
        harness.requests
          .map(decodeURIComponent)
          .some((r) => r.includes('categories=продукты') && r.includes('by=name')),
      ).toBe(true),
    );
  });

  it('группа сворачивается и разворачивается по заголовку', async () => {
    harness.handlers['/api/budgets'] = () =>
      analyticsOk([
        budget(),
        budget({
          id: 'c',
          categoryId: '3',
          category: 'Игры',
          level: 'ok',
          percent: 10,
          remaining: 900,
        }),
      ]);
    const user = renderAnalytics();
    await overall();
    const details = screen.getByText('Остальные категории').closest('details')!;
    expect(details).toHaveAttribute('open');

    await user.click(screen.getByText('Остальные категории'));
    expect(details).not.toHaveAttribute('open');
    await user.click(screen.getByText('Остальные категории'));
    expect(details).toHaveAttribute('open');
  });

  it('без общего лимита блока «Общий бюджет» нет, группы остаются', async () => {
    harness.handlers['/api/budgets'] = () =>
      analyticsOk([
        budget({
          id: 'c',
          categoryId: '3',
          category: 'Игры',
          level: 'ok',
          percent: 10,
          remaining: 900,
        }),
      ]);
    renderAnalytics();

    expect(await screen.findByText('Остальные категории')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Общий бюджет' })).toBeNull();
  });

  it('без лимитов вкладок нет, карточка как структура', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([]);
    renderAnalytics();
    await screen.findByRole('heading', { name: 'Расход по категориям' });

    expect(screen.queryByRole('radiogroup', { name: 'Раздел' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(await screen.findByText(/Всего расходов/)).toBeInTheDocument();
  });

  it('на других вкладках полосок нет', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    harness.handlers['/api/expenses'] = () => analyticsOk({ items: [], total: 0, totalAmount: 0 });
    renderAnalytics('/analytics/operations');
    await screen.findByRole('heading', { name: 'Все операции' });

    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
