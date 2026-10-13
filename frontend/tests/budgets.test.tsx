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

    const bar = await screen.findByRole('progressbar', { name: 'Лимит: Всего' });
    const row = bar.closest('li')!;
    expect(row).toHaveTextContent(/41%\s*· осталось 59,50 USD/);
    expect(row).toHaveAttribute('title', 'лимит 100,00 USD · 01.10–31.10');
    expect(row).not.toHaveTextContent('AMD');
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
    await screen.findByRole('progressbar', { name: 'Лимит: Всего' });
    expect(harness.requests).toContain('/api/budgets?currency=AMD');

    await user.click(await screen.findByRole('radio', { name: /RUB/ }));

    await waitFor(() => expect(harness.requests).toContain('/api/budgets?currency=RUB'));
    expect(
      (await screen.findByRole('progressbar', { name: 'Лимит: Всего' })).closest('li'),
    ).toHaveTextContent(/осталось 3 444,00 RUB/);
  });

  it('полоски внутри карточки «Расход по категориям», отдельной карточки нет', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    renderAnalytics();
    await screen.findByRole('heading', { name: 'Расход по категориям' });

    const bar = await within(categoryCard()).findByRole('progressbar', { name: 'Лимит: Всего' });
    const region = screen.getByRole('region', { name: 'Лимиты' });
    expect(categoryCard()).toContainElement(region);
    expect(screen.getAllByRole('region', { name: 'Лимиты' })).toHaveLength(1);
    // Under the card's header and switches, above the chart; «Всего» is the first row
    expect(within(region).getAllByRole('progressbar')[0]).toBe(bar);
  });

  it('только «Всего» остаётся первой строкой, дальше категории по порядку', async () => {
    harness.handlers['/api/budgets'] = () =>
      analyticsOk([budget(), budget({ id: 'c', categoryId: '3', category: 'Игры' })]);
    renderAnalytics();

    const region = await screen.findByRole('region', { name: 'Лимиты' });
    const names = within(region)
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-label'));
    expect(names).toEqual(['Лимит: Всего', 'Лимит: Игры']);
  });

  it('без лимитов карточка категорий без изменений', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([]);
    renderAnalytics();
    await screen.findByRole('heading', { name: 'Расход по категориям' });

    expect(screen.queryByRole('region', { name: 'Лимиты' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('вверху обзора отдельной карточки с лимитами нет', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    renderAnalytics();
    await screen.findByRole('progressbar', { name: 'Лимит: Всего' });

    const region = screen.getByRole('region', { name: 'Лимиты' });
    expect(region.parentElement?.closest('section')).toBe(categoryCard());
  });

  it('на других вкладках полосок нет', async () => {
    harness.handlers['/api/budgets'] = () => analyticsOk([budget()]);
    harness.handlers['/api/expenses'] = () => analyticsOk({ items: [], total: 0, totalAmount: 0 });
    renderAnalytics('/analytics/operations');
    await screen.findByRole('heading', { name: 'Все операции' });

    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
