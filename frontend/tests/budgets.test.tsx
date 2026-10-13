import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('выбор категории', () => {
    let scroll: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      scroll = vi.fn();
      Element.prototype.scrollIntoView =
        scroll as unknown as typeof Element.prototype.scrollIntoView;
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
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('после клика страница плавно прокручивается к блоку наименований, и при повторном клике тоже', async () => {
      const user = renderAnalytics();
      await overall();
      const row = screen.getByRole('button', { name: 'продукты: открыть наименования' });

      await user.click(row);
      await user.click(row);

      expect(scroll).toHaveBeenCalledTimes(2);
      expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      const target = scroll.mock.contexts[0] as HTMLElement;
      expect(target.id).toBe('category-names');
      expect(target).toContainElement(
        screen.getByRole('heading', { name: 'Наименования в категории' }),
      );
    });

    it('при prefers-reduced-motion без анимации', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
      }));
      const user = renderAnalytics();
      await overall();

      await user.click(screen.getByRole('button', { name: 'продукты: открыть наименования' }));

      expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    });

    it('строка выглядит кликабельной; выбранная подсвечена', async () => {
      const user = renderAnalytics();
      await overall();
      const row = screen.getByRole('button', { name: 'продукты: открыть наименования' });
      expect(row).toHaveClass('cursor-pointer');
      expect(row.className).toMatch(/hover:bg-/);
      expect(row).not.toHaveAttribute('aria-current');

      await user.click(row);

      await waitFor(() => expect(row).toHaveAttribute('aria-current', 'true'));
      expect(row).toHaveClass('bg-indigo-50');
    });

    it('в структуре: строка легенды кольца кликабельна и тоже прокручивает', async () => {
      localStorage.setItem('analytics.category.tab', 'structure');
      harness.handlers['/api/preferences'] = () => analyticsOk({ 'category.tab': 'structure' });
      const user = renderAnalytics();
      const legend = await screen.findByRole('button', { name: 'кафе: показать наименования' });
      expect(legend).toHaveClass('cursor-pointer');

      await user.click(legend);

      expect(scroll).toHaveBeenCalledTimes(1);
    });
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

describe('лимиты и фильтры категорий', () => {
  setupAnalyticsHarness();

  const limits = () =>
    analyticsOk([
      budget(),
      budget({
        id: 'a',
        categoryId: '1',
        category: 'кафе',
        level: 'over',
        percent: 120,
        spent: 1200,
        limit: 1000,
        remaining: -200,
      }),
      budget({
        id: 'b',
        categoryId: '2',
        category: 'продукты',
        level: 'ok',
        percent: 10,
        spent: 100,
        limit: 1000,
        remaining: 900,
      }),
      budget({
        id: 'c',
        categoryId: '3',
        category: 'старая',
        level: 'warn',
        percent: 85,
        spent: 850,
        limit: 1000,
        remaining: 150,
      }),
    ]);
  const archived = () =>
    (harness.handlers['/api/analytics/categories'] = () =>
      analyticsOk([
        { name: 'кафе', archived: false },
        { name: 'продукты', archived: false },
        { name: 'старая', archived: true },
      ]));
  const bar = (name: string) => screen.queryByRole('progressbar', { name: `Лимит: ${name}` });

  it('исключённая категория скрыта, общий бюджет и остальные на месте; пустая группа не показывается', async () => {
    harness.handlers['/api/budgets'] = limits;
    archived();
    renderAnalytics(`/analytics?exclude_categories=${encodeURIComponent('кафе')}&archive=1`);
    await screen.findByRole('region', { name: 'Общий бюджет' });

    expect(bar('Всего')).not.toBeNull();
    expect(bar('кафе')).toBeNull();
    expect(bar('продукты')).not.toBeNull();
    // «Превышен лимит» had only кафе: the group is gone
    expect(screen.queryByText('Превышен лимит')).toBeNull();
    expect(screen.getByText('Близко к лимиту')).toBeInTheDocument();
  });

  it('если выбраны категории, остальные скрыты', async () => {
    harness.handlers['/api/budgets'] = limits;
    archived();
    renderAnalytics(`/analytics?category=${encodeURIComponent('продукты')}`);
    await screen.findByRole('region', { name: 'Общий бюджет' });

    expect(bar('продукты')).not.toBeNull();
    expect(bar('кафе')).toBeNull();
    expect(bar('старая')).toBeNull();
    expect(screen.getByText('Остальные категории').closest('details')).toHaveTextContent(
      '1 категория',
    );
    expect(screen.queryByText('Близко к лимиту')).toBeNull();
  });

  it('архивная категория скрыта по умолчанию', async () => {
    harness.handlers['/api/budgets'] = limits;
    archived();
    renderAnalytics();
    await screen.findByRole('region', { name: 'Общий бюджет' });
    await waitFor(() => expect(bar('старая')).toBeNull());

    expect(bar('кафе')).not.toBeNull();
    expect(screen.queryByText('Близко к лимиту')).toBeNull();
  });

  it('архивная категория видна с «Показывать архив»', async () => {
    harness.handlers['/api/budgets'] = limits;
    archived();
    renderAnalytics('/analytics?archive=1');

    expect(await screen.findByRole('progressbar', { name: 'Лимит: старая' })).toBeInTheDocument();
    expect(screen.getByText('Близко к лимиту')).toBeInTheDocument();
  });

  it('архивная категория, выбранная явно, видна и без переключателя', async () => {
    harness.handlers['/api/budgets'] = limits;
    archived();
    renderAnalytics(`/analytics?category=${encodeURIComponent('старая')}`);

    expect(await screen.findByRole('progressbar', { name: 'Лимит: старая' })).toBeInTheDocument();
    expect(bar('кафе')).toBeNull();
  });

  it('исключённая архивная категория скрыта даже с «Показывать архив»', async () => {
    harness.handlers['/api/budgets'] = limits;
    archived();
    renderAnalytics(`/analytics?archive=1&exclude_categories=${encodeURIComponent('старая')}`);
    await screen.findByRole('region', { name: 'Общий бюджет' });

    expect(bar('старая')).toBeNull();
    expect(bar('кафе')).not.toBeNull();
  });
});
