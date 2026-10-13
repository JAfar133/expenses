import { screen, waitFor, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { compactNumber } from '../src/features/analytics/model/chart-data.ts';
import { currencyLabel, flagOf, moneyDigits } from '../src/features/analytics/model/currency.ts';
import {
  harness,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
  stats,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const RATES = [
  { currency: 'RUB', rate: 4.5, fetchedAt: '2026-10-10T10:00:00.000Z' },
  { currency: 'USD', rate: 380, fetchedAt: '2026-10-10T10:00:00.000Z' },
];

describe('формат валют', () => {
  it('флаги и подписи', () => {
    expect(flagOf('AMD')).toBe('🇦🇲');
    expect(flagOf('USD')).toBe('🇺🇸');
    expect(flagOf('EUR')).toBe('🇪🇺');
    expect(flagOf('XYZ')).toBe('💱');
    expect(currencyLabel('RUB')).toBe('🇷🇺 RUB');
  });

  it('знаков после запятой: драммы целые, остальные валюты с копейками', () => {
    expect(moneyDigits('AMD', 'AMD')).toBe(0);
    expect(moneyDigits('USD', 'AMD')).toBe(2);
  });

  it('оси: небольшие дробные суммы с запятой', () => {
    expect(compactNumber(12.5)).toBe('12,5');
    expect(compactNumber(0.37)).toBe('0,37');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1500)).toBe('1,5K');
  });
});

const tile = (label: string) =>
  screen.getByText(label, { selector: 'div' }).parentElement as HTMLElement;
const group = () => screen.findByRole('radiogroup', { name: 'Валюта отображения' });
const pick = async (user: ReturnType<typeof userEvent.setup>, code: string) =>
  user.click(within(await group()).getByRole('radio', { name: new RegExp(code) }));
const withRates = () => {
  harness.handlers['/api/rates'] = () =>
    ok({ base: 'AMD', currencies: ['AMD', 'RUB', 'USD', 'EUR'], rates: RATES });
};

const summaryRequests = () =>
  harness.requests.filter((r) => r.startsWith('/api/analytics/summary')).map(decodeURIComponent);

describe('отчётность группы не в драммах', () => {
  const reportInDollars = () => {
    withRates();
    harness.handlers['/api/config'] = () => ok({ currency: 'USD', baseCurrency: 'AMD' });
  };

  it('по умолчанию суммы показаны в валюте отчётности, драммы тоже есть в списке', async () => {
    reportInDollars();
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100,00 USD'));
    await waitFor(() =>
      expect(
        within(screen.getByRole('radiogroup', { name: 'Валюта отображения' }))
          .getAllByRole('radio')
          .map((o) => o.textContent),
      ).toEqual(['🇺🇸 USD', '🇷🇺 RUB', '🇦🇲 AMD']),
    );
    expect(screen.getByText('Суммы в USD')).toBeInTheDocument();
  });

  it('выбор драммов — запрос с currency=AMD, суммы показаны как пришли с сервера', async () => {
    reportInDollars();
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100,00 USD'));
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇦🇲 AMD' })).toBeInTheDocument());

    await pick(user, 'AMD');

    await waitFor(() => expect(summaryRequests().at(-1)).toContain('currency=AMD'));
    // The mocked server returns 2100 whatever the currency: the client does not recalculate it
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
  });
});

describe('выбор валюты на странице анализа', () => {
  it('в списке флаги стран и коды валют, у которых есть курс (и базовая)', async () => {
    withRates();
    renderAnalytics();

    const field = await group();

    await waitFor(() =>
      expect(
        within(field)
          .getAllByRole('radio')
          .map((o) => o.textContent),
      ).toEqual(['🇦🇲 AMD', '🇷🇺 RUB', '🇺🇸 USD']),
    );
    expect(within(field).getByRole('radio', { name: /AMD/ })).toBeChecked();
  });

  it('если курсов нет или они не загрузились, выбора нет и всё в базовой валюте', async () => {
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    expect(screen.queryByRole('radiogroup', { name: 'Валюта отображения' })).toBeNull();
  });

  it('каждый запрос аналитики несёт currency, и по умолчанию это валюта отчётности', async () => {
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    for (const path of ['summary', 'timeseries', 'breakdown']) {
      const urls = harness.requests
        .filter((r) => r.startsWith(`/api/analytics/${path}`))
        .filter((r) => !r.includes('by=card'))
        .map(decodeURIComponent);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url).toContain('currency=AMD');
    }
  });

  it('выбор рубля: запросы с currency=RUB, числа с сервера показаны без пересчёта на клиенте', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇷🇺 RUB' })).toBeInTheDocument());

    await pick(user, 'RUB');

    await waitFor(() => expect(summaryRequests().at(-1)).toContain('currency=RUB'));
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100,00 RUB'));
    expect(tile('В день')).toHaveTextContent('140,00 RUB');
    expect(tile('Средний чек')).toHaveTextContent('420,00 RUB');
    expect(tile('Самая крупная')).toHaveTextContent('700,00 RUB');
    expect(tile('Операций')).toHaveTextContent('5');
    expect(tile('Потрачено')).not.toHaveTextContent('AMD');
    const categoryRequests = harness.requests
      .filter((r) => r.includes('by=category'))
      .map(decodeURIComponent);
    expect(categoryRequests.at(-1)).toContain('currency=RUB');
    const seriesRequests = harness.requests.filter((r) =>
      r.startsWith('/api/analytics/timeseries'),
    );
    expect(decodeURIComponent(seriesRequests.at(-1)!)).toContain('currency=RUB');
  });

  it('изменение к предыдущему периоду в процентах не зависит от валюты', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('больше на 110%'));

    await pick(user, 'USD');

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('USD'));
    expect(tile('Потрачено')).toHaveTextContent('больше на 110%');
  });

  it('таблицы данных графиков показывают числа сервера, доли остаются', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇺🇸 USD' })).toBeInTheDocument());

    await pick(user, 'USD');

    const tables = await screen.findAllByRole('table', { hidden: true });
    const categories = tables.find((t) => within(t).queryByText('Категория', { exact: false }))!;
    await waitFor(() => expect(within(categories).getByText('1 500')).toBeInTheDocument());
    expect(within(categories).getByText('71,4%')).toBeInTheDocument();
    expect(within(categories).getByText('Сумма, USD', { exact: false })).toBeInTheDocument();
  });

  it('под выбором: для валюты отчётности «Суммы в …», для другой — пояснение про пересчёт', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇺🇸 USD' })).toBeInTheDocument());
    expect(screen.getByText('Суммы в AMD')).toBeInTheDocument();

    await pick(user, 'USD');

    expect(
      await screen.findByText(
        'Траты в USD показаны как введены, остальные пересчитаны по курсу ЦБ на день траты',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 USD =/)).toBeNull();
  });

  it('выбор сохраняется в настройках пользователя', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇷🇺 RUB' })).toBeInTheDocument());

    await pick(user, 'RUB');

    await waitFor(() => {
      const index = harness.requests.findIndex((r) => r === 'PUT /api/preferences');
      expect(harness.bodies[index]).toEqual({ 'analytics.currency': 'RUB' });
    });
    expect(localStorage.getItem('analytics.analytics.currency')).toBe('RUB');
  });

  it('сохранённая на сервере валюта применяется сразу: запросы с этой валютой', async () => {
    withRates();
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'USD' });
    renderAnalytics();

    await waitFor(() => expect(summaryRequests().at(-1)).toContain('currency=USD'));
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100,00 USD'));
    expect(within(await group()).getByRole('radio', { name: /USD/ })).toBeChecked();
  });

  it('сохранённая валюта без курса не ломает страницу: показываются драммы', async () => {
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'EUR' });
    harness.handlers['/api/rates'] = () =>
      ok({ base: 'AMD', currencies: ['AMD', 'EUR'], rates: [] });
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
  });

  it('выбор действует на всех вкладках анализа', async () => {
    withRates();
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'USD' });
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('USD'));

    await user.click(screen.getByRole('link', { name: 'Сравнение месяцев' }));

    expect(within(await group()).getByRole('radio', { name: /USD/ })).toBeChecked();
    await user.click(screen.getByRole('link', { name: 'Операции' }));
    expect(within(await group()).getByRole('radio', { name: /USD/ })).toBeChecked();
  });

  it('вкладка сравнения месяцев: запросы с валютой, суммы как у сервера', async () => {
    withRates();
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'USD' });
    harness.handlers['/api/analytics/timeseries'] = (url) =>
      ok(
        url.searchParams.get('splitBy') === 'category'
          ? []
          : [
              { period: '2026-09-01', total: 3800, count: 4 },
              { period: '2026-10-01', total: 1900, count: 2 },
            ],
      );
    renderAnalytics('/analytics/compare');

    const monthsTable = await screen.findByRole('table', { name: 'Расходы по месяцам' });

    await waitFor(() => expect(within(monthsTable).getByText('1 900 USD')).toBeInTheDocument());
    expect(within(monthsTable).getByText('3 800 USD')).toBeInTheDocument();
    for (const request of harness.requests.filter((r) => r.startsWith('/api/analytics/'))) {
      if (/by=card|\/authors|\/cards|\/categories/.test(request)) continue;
      expect(decodeURIComponent(request)).toContain('currency=USD');
    }
  });

  it('журнал операций: запрос списка с currency, итог в валюте показа', async () => {
    withRates();
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'RUB' });
    harness.handlers['/api/expenses'] = () => ok({ items: [], total: 0, totalAmount: 0 });
    renderAnalytics('/analytics/operations');

    await waitFor(() =>
      expect(
        harness.requests
          .filter((r) => r.startsWith('/api/expenses?'))
          .map(decodeURIComponent)
          .at(-1),
      ).toContain('currency=RUB'),
    );
  });
});

describe('общий модуль флагов', () => {
  it('форма расхода и анализ используют одни и те же подписи', async () => {
    const shared = await import('../src/shared/utils/currency-flags.ts');

    expect(shared.currencyLabel('USD')).toBe(currencyLabel('USD'));
    expect(shared.flagOf('XYZ')).toBe('💱');
  });
});
