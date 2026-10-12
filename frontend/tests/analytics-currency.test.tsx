import { screen, waitFor, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { compactNumber } from '../src/features/analytics/model/chart-data.ts';
import {
  currencyLabel,
  flagOf,
  moneyDigits,
  scaleBreakdown,
  scaleFactor,
  scaleSeries,
  scaleSummary,
} from '../src/features/analytics/model/currency.ts';
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

describe('модель пересчёта при отчётности в другой валюте', () => {
  it('moneyDigits: целые только драммы (базовая валюта), остальные с копейками', () => {
    expect(moneyDigits('AMD', 'AMD')).toBe(0);
    expect(moneyDigits('USD', 'AMD')).toBe(2);
  });

  it('scaleFactor: отчётность в долларах → драммы умножаются на курс доллара', () => {
    expect(scaleFactor('AMD', 'USD', RATES, 'AMD')).toBeCloseTo(380);
    expect(scaleFactor('USD', 'USD', RATES, 'AMD')).toBe(1);
    // USD → RUB: 1 USD = 380 AMD = 84,44 RUB
    expect(scaleFactor('RUB', 'USD', RATES, 'AMD')).toBeCloseTo(380 / 4.5);
  });

  it('scaleFactor: нет курса — множитель 1', () => {
    expect(scaleFactor('EUR', 'USD', RATES, 'AMD')).toBe(1);
  });

  it('scaleSummary с знаками: пересчитанные суммы округляются до знаков валюты', () => {
    const summary = {
      current: { ...stats(), total: 10.123, perDay: 1.116, average: 5.05, median: 5, max: 9.999 },
      previous: null,
    };
    expect(scaleSummary(summary, 380, 0).current.total).toBe(3847);
    expect(scaleSummary(summary, 1, 0)).toBe(summary);
  });
});

describe('модель пересчёта', () => {
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

  it('scaleFactor: сумма в драммах делится на курс', () => {
    expect(scaleFactor('AMD', 'AMD', RATES)).toBe(1);
    expect(scaleFactor('USD', 'AMD', RATES)).toBeCloseTo(1 / 380);
    expect(scaleFactor('RUB', 'AMD', RATES)).toBeCloseTo(1 / 4.5);
  });

  it('scaleFactor: нет курса или он некорректен — множитель 1', () => {
    expect(scaleFactor('EUR', 'AMD', RATES)).toBe(1);
    expect(scaleFactor('USD', 'AMD', undefined)).toBe(1);
    expect(scaleFactor('USD', 'AMD', [{ currency: 'USD', rate: 0 }])).toBe(1);
    expect(scaleFactor('USD', 'AMD', [{ currency: 'USD', rate: -5 }])).toBe(1);
  });

  const summary = {
    current: { ...stats(), total: 3800, perDay: 380, average: 760, median: 380, max: 1900 },
    previous: { ...stats(), total: 1900, perDay: 190, average: 380, median: 190, max: 950 },
  };

  it('scaleSummary меняет суммы, но не количества, дни и даты', () => {
    const scaled = scaleSummary(summary, 1 / 380);

    expect(scaled.current).toMatchObject({
      total: 10,
      perDay: 1,
      average: 2,
      median: 1,
      max: 5,
      count: 5,
      days: 15,
      activeDays: 3,
      firstDate: '2026-10-01',
    });
    expect(scaled.previous).toMatchObject({ total: 5, count: 5 });
  });

  it('scaleSummary без предыдущего периода и с множителем 1', () => {
    expect(scaleSummary({ ...summary, previous: null }, 0.5).previous).toBeNull();
    expect(scaleSummary(summary, 1)).toBe(summary);
  });

  it('scaleSeries и scaleBreakdown: суммы пересчитываются, остальное остаётся; исходные данные не меняются', () => {
    const series = [{ period: '2026-10-01', total: 760, count: 2, key: 'кафе' }];
    const rows = [{ key: 'кафе', total: 760, count: 2, average: 380 }];

    expect(scaleSeries(series, 1 / 380)).toEqual([
      { period: '2026-10-01', total: 2, count: 2, key: 'кафе' },
    ]);
    expect(scaleBreakdown(rows, 1 / 380)).toEqual([
      { key: 'кафе', total: 2, count: 2, average: 1 },
    ]);
    expect(series[0]!.total).toBe(760);
    expect(scaleSeries(series, 1)).toBe(series);
    expect(scaleBreakdown(rows, 1)).toBe(rows);
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

  it('выбор драммов умножает суммы на курс доллара и округляет до целых', async () => {
    reportInDollars();
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100,00 USD'));
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇦🇲 AMD' })).toBeInTheDocument());

    await pick(user, 'AMD');

    // 2100 USD * 380 = 798 000 AMD; the rate note is the cross rate in the reporting currency
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('798 000 AMD'));
    expect(screen.getByText(/1 AMD = 0,0026 USD/)).toBeInTheDocument();
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

  it('выбор доллара пересчитывает плитки, количества не меняются', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇺🇸 USD' })).toBeInTheDocument());

    await pick(user, 'USD');

    // 2100 / 380 = 5,53; 140 / 380 = 0,37; 420 / 380 = 1,11; 700 / 380 = 1,84
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('5,53 USD'));
    expect(tile('В день')).toHaveTextContent('0,37 USD');
    expect(tile('Средний чек')).toHaveTextContent('1,11 USD');
    expect(tile('Самая крупная')).toHaveTextContent('1,84 USD');
    expect(tile('Операций')).toHaveTextContent('5');
    expect(tile('Потрачено')).not.toHaveTextContent('AMD');
  });

  it('изменение к предыдущему периоду в процентах не зависит от валюты', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('больше на 110%'));

    await pick(user, 'USD');

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('USD'));
    expect(tile('Потрачено')).toHaveTextContent('больше на 110%');
  });

  it('таблицы данных графиков пересчитаны, доли остаются', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇺🇸 USD' })).toBeInTheDocument());

    await pick(user, 'USD');

    const tables = await screen.findAllByRole('table', { hidden: true });
    const categories = tables.find((t) => within(t).queryByText('Категория', { exact: false }))!;
    // 1500 / 380 = 3.95, share 71.4%
    await waitFor(() => expect(within(categories).getByText('3,95')).toBeInTheDocument());
    expect(within(categories).getByText('71,4%')).toBeInTheDocument();
    expect(within(categories).getByText('Сумма, USD', { exact: false })).toBeInTheDocument();
  });

  it('под выбором указан курс ЦБ и дата', async () => {
    withRates();
    const user = renderAnalytics();
    await waitFor(() => expect(screen.getByRole('radio', { name: '🇺🇸 USD' })).toBeInTheDocument());
    expect(screen.queryByText(/курс ЦБ/)).toBeNull();

    await pick(user, 'USD');

    expect(await screen.findByText('1 USD = 380 AMD · курс ЦБ на 10.10.2026')).toBeInTheDocument();
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

  it('сохранённая на сервере валюта применяется сразу', async () => {
    withRates();
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'USD' });
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('5,53 USD'));
    expect(within(await group()).getByRole('radio', { name: /USD/ })).toBeChecked();
  });

  it('сохранённая валюта без курса не ломает страницу: показываются драммы', async () => {
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'EUR' });
    harness.handlers['/api/rates'] = () =>
      ok({ base: 'AMD', currencies: ['AMD', 'EUR'], rates: [] });
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
  });

  it('выбор действует на всех вкладках анализа, кроме журнала операций (там записи в драммах)', async () => {
    withRates();
    harness.handlers['/api/preferences'] = () => ok({ 'analytics.currency': 'USD' });
    const user = renderAnalytics();
    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('USD'));

    await user.click(screen.getByRole('link', { name: 'Сравнение месяцев' }));

    expect(within(await group()).getByRole('radio', { name: /USD/ })).toBeChecked();
    await user.click(screen.getByRole('link', { name: 'Операции' }));
    expect(within(await group()).getByRole('radio', { name: /USD/ })).toBeChecked();
  });

  it('на вкладке сравнения месяцев суммы тоже пересчитаны', async () => {
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

    await waitFor(() => expect(within(monthsTable).getByText('10 USD')).toBeInTheDocument());
    expect(within(monthsTable).getByText('5 USD')).toBeInTheDocument();
  });
});

describe('общий модуль флагов', () => {
  it('форма расхода и анализ используют одни и те же подписи', async () => {
    const shared = await import('../src/shared/utils/currency-flags.ts');

    expect(shared.currencyLabel('USD')).toBe(currencyLabel('USD'));
    expect(shared.flagOf('XYZ')).toBe('💱');
  });
});
