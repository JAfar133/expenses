import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  harness,
  json,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

/** 12 months up to and including October 2026, as the server returns them (gaps zero-filled). */
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const index = 2025 * 12 + 11 + i; // starting from November 2025
  return `${Math.floor((index - 1) / 12)}-${String(((index - 1) % 12) + 1).padStart(2, '0')}-01`;
});
const TOTALS: Record<string, [number, number]> = {
  '2026-08-01': [1000, 4],
  '2026-09-01': [1500, 6],
  '2026-10-01': [600, 2],
};
const monthly = MONTHS.map((period) => ({
  period,
  total: TOTALS[period]?.[0] ?? 0,
  count: TOTALS[period]?.[1] ?? 0,
}));
const byCategory = [
  { period: '2026-09-01', key: 'жилье', total: 900, count: 1 },
  { period: '2026-09-01', key: 'кафе', total: 600, count: 5 },
  { period: '2026-10-01', key: 'кафе', total: 600, count: 2 },
];

const monthRowsBreakdown: Record<string, unknown> = {
  '2026-10-01': [{ key: 'кафе', total: 600, count: 2, average: 300 }],
  '2026-09-01': [
    { key: 'жилье', total: 900, count: 1, average: 900 },
    { key: 'кафе', total: 600, count: 5, average: 120 },
  ],
};

function useCompareData() {
  harness.handlers['/api/analytics/timeseries'] = (url) =>
    url.searchParams.get('splitBy') === 'category' ? ok(byCategory) : ok(monthly);
  harness.handlers['/api/analytics/breakdown'] = (url) => {
    const from = url.searchParams.get('from') ?? '';
    return ok(monthRowsBreakdown[from] ?? []);
  };
}

const timeseriesRequests = () =>
  harness.requests.filter((r) => r.startsWith('/api/analytics/timeseries'));
const location = () => screen.getByTestId('location');

/** `configure` changes the server responses after the defaults but before the first request. */
function renderCompare(path = '/analytics/compare', configure?: () => void) {
  useCompareData();
  configure?.();
  return renderAnalytics(path);
}

const table = (name: string) => screen.getByRole('table', { name });

describe('вкладки', () => {
  it('«Сравнение месяцев» открывается из вкладок раздела и отмечена активной', async () => {
    useCompareData();
    const user = renderAnalytics();

    await user.click(await screen.findByRole('link', { name: 'Сравнение месяцев' }));

    expect(
      await screen.findByRole('heading', { name: 'Сравнение по месяцам' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Сравнение месяцев' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Обзор' })).not.toHaveAttribute('aria-current');
  });

  it('у сравнения свой период: выбора периода в фильтрах нет', async () => {
    renderCompare();
    await screen.findByRole('heading', { name: 'Сравнение по месяцам' });

    expect(screen.queryByRole('radiogroup', { name: 'Период' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Диапазон дат/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Фильтры/ })).toBeInTheDocument();
  });
});

describe('запросы', () => {
  it('по умолчанию 12 месяцев до текущего: итоги по месяцам и по категориям', async () => {
    renderCompare();

    await waitFor(() => expect(timeseriesRequests()).toHaveLength(2));
    expect(timeseriesRequests()).toContain(
      '/api/analytics/timeseries?from=2025-11-01&to=2026-10-31&granularity=month',
    );
    expect(timeseriesRequests()).toContain(
      '/api/analytics/timeseries?from=2025-11-01&to=2026-10-31&granularity=month&splitBy=category',
    );
  });

  it.each([
    ['6', '2026-05-01'],
    ['24', '2024-11-01'],
  ])('диапазон %s месяцев начинается с %s, выбор запоминается', async (months, from) => {
    const user = renderCompare();
    await screen.findByRole('heading', { name: 'Сравнение по месяцам' });

    await user.click(screen.getByRole('radio', { name: `${months} мес.` }));

    await waitFor(() =>
      expect(timeseriesRequests()).toContain(
        `/api/analytics/timeseries?from=${from}&to=2026-10-31&granularity=month`,
      ),
    );
    expect(localStorage.getItem('analytics.compare.months')).toBe(months);
  });

  it('общие фильтры применяются, а период из фильтров нет', async () => {
    renderCompare('/analytics/compare?period=30d&card=Миша');

    await waitFor(() => expect(timeseriesRequests().length).toBeGreaterThan(0));

    const request = decodeURIComponent(timeseriesRequests()[0]!);
    expect(request).toContain('from=2025-11-01&to=2026-10-31');
    expect(request).toContain('cards=Миша');
  });
});

describe('таблица по месяцам', () => {
  const rowOf = (text: string) =>
    within(table('Расходы по месяцам'))
      .getAllByRole('row')
      .find((row) => row.querySelector('th')?.textContent?.startsWith(text))!;

  it('суммы, число операций, расход в день и изменение к предыдущему месяцу', async () => {
    renderCompare();
    await screen.findByRole('table', { name: 'Расходы по месяцам' });

    const october = rowOf('Октябрь 2026');
    expect(october).toHaveTextContent('не закончился');
    expect(october).toHaveTextContent('600 AMD');
    expect(october).toHaveTextContent('40'); // 600 over 15 elapsed days
    // An unfinished month is not compared with the previous one
    expect(october).toHaveTextContent('—');
    expect(october).not.toHaveTextContent('%');
    const september = rowOf('Сентябрь 2026');
    expect(september).toHaveTextContent('1 500 AMD');
    expect(september).toHaveTextContent('+50%');
    expect(rowOf('Ноябрь 2025')).toHaveTextContent('—');
  });

  it('по умолчанию новые месяцы сверху', async () => {
    renderCompare();
    const monthsTable = await screen.findByRole('table', { name: 'Расходы по месяцам' });

    const first = within(monthsTable).getAllByRole('row')[1]!;

    expect(first.querySelector('th')).toHaveTextContent('Октябрь 2026');
  });

  it('сортировка по сумме: по убыванию, затем по возрастанию', async () => {
    const user = renderCompare();
    const monthsTable = await screen.findByRole('table', { name: 'Расходы по месяцам' });
    const first = () =>
      within(monthsTable).getAllByRole('row')[1]!.querySelector('th')!.textContent;
    const header = () => within(monthsTable).getByRole('columnheader', { name: /Потрачено/ });

    await user.click(within(monthsTable).getByRole('button', { name: /Потрачено/ }));
    expect(first()).toContain('Сентябрь 2026'); // 1500 is the largest sum
    expect(header()).toHaveAttribute('aria-sort', 'descending');

    await user.click(within(monthsTable).getByRole('button', { name: /Потрачено/ }));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
    expect(first()).not.toContain('Сентябрь 2026');
  });
});

describe('месяц к месяцу', () => {
  it('по умолчанию текущий месяц к предыдущему; таблица с разницей по категориям', async () => {
    renderCompare();

    const first = await screen.findByRole('combobox', { name: 'Первый месяц' });
    expect(first).toHaveValue('2026-10');
    expect(screen.getByRole('combobox', { name: 'Второй месяц' })).toHaveValue('2026-09');

    const rows = await screen.findAllByRole('row');
    const housing = rows.find(
      (r) => r.textContent?.startsWith('жилье') && r.textContent.includes('900'),
    )!;
    // October 0, September 900: difference −900, −100%
    expect(housing).toHaveTextContent('-900');
    expect(housing).toHaveTextContent('-100%');
    const cafe = rows.find(
      (r) => r.textContent?.startsWith('кафе') && r.textContent.includes('600'),
    )!;
    expect(cafe).toHaveTextContent('0%');
  });

  it('сначала самые заметные расхождения', async () => {
    renderCompare();

    const comparison = await screen.findByRole('table', {
      name: 'Сравнение категорий двух месяцев',
    });
    const categories = within(comparison)
      .getAllByRole('row')
      .map((r) => r.querySelector('th[scope="row"]')?.textContent)
      .filter(Boolean);

    expect(categories).toEqual(['жилье', 'кафе']);
  });

  it('итоги двух месяцев и общая разница в процентах', async () => {
    renderCompare();

    expect(await screen.findByText(/Октябрь 2026/, { selector: 'strong' })).toBeInTheDocument();
    const summary = screen.getByText(/Октябрь 2026/, { selector: 'strong' }).closest('p')!;
    expect(summary).toHaveTextContent('600 AMD');
    expect(summary).toHaveTextContent('1 500 AMD');
    expect(summary).toHaveTextContent('-60%');
  });

  it('выбор месяцев попадает в адрес и меняет запросы', async () => {
    const user = renderCompare();
    const second = await screen.findByRole('combobox', { name: 'Второй месяц' });

    await user.selectOptions(second, '2026-08');

    await waitFor(() => expect(location()).toHaveTextContent('a=2026-10&b=2026-08'));
    await waitFor(() =>
      expect(harness.requests).toContain(
        '/api/analytics/breakdown?from=2026-08-01&to=2026-08-31&by=category',
      ),
    );
  });

  it('месяцы из адреса применяются, а вне диапазона заменяются значениями по умолчанию', async () => {
    renderCompare('/analytics/compare?a=2026-08&b=2019-01');

    expect(await screen.findByRole('combobox', { name: 'Первый месяц' })).toHaveValue('2026-08');
    expect(screen.getByRole('combobox', { name: 'Второй месяц' })).toHaveValue('2026-09');
  });

  it('в списках месяцев новые сверху', async () => {
    renderCompare();
    const first = await screen.findByRole('combobox', { name: 'Первый месяц' });

    const options = within(first)
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(options[0]).toBe('Октябрь 2026');
    expect(options).toHaveLength(12);
    expect(options.at(-1)).toBe('Ноябрь 2025');
  });

  it('если в месяцах нет расходов, показывает сообщение', async () => {
    renderCompare('/analytics/compare?a=2026-08&b=2026-07', () => {
      harness.handlers['/api/analytics/breakdown'] = () => ok([]);
    });

    expect(await screen.findByText('В этих месяцах расходов нет')).toBeInTheDocument();
  });
});

describe('состояния', () => {
  it('нет расходов за выбранные месяцы: сообщения вместо графиков', async () => {
    renderCompare('/analytics/compare', () => {
      // As the server returns: zero-filled months, and no points at all when split by category
      harness.handlers['/api/analytics/timeseries'] = (url) =>
        ok(
          url.searchParams.get('splitBy') === 'category'
            ? []
            : monthly.map((point) => ({ ...point, total: 0, count: 0 })),
        );
    });

    expect(await screen.findAllByText('За выбранные месяцы расходов нет')).toHaveLength(2);
  });

  it('ошибка загрузки: сообщение и повтор', async () => {
    let failing = true;
    const user = renderCompare('/analytics/compare', () => {
      const normal = harness.handlers['/api/analytics/timeseries']!;
      harness.handlers['/api/analytics/timeseries'] = (url) =>
        failing ? json({ success: false, error: { code: 'X', message: 'x' } }, 500) : normal(url);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('графики', () => {
  it('«Категории по месяцам»: два вида, выбор запоминается', async () => {
    const user = renderCompare();
    const group = await screen.findByRole('radiogroup', { name: 'Вид графика' });

    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['С накоплением', 'Линии']);
    await user.click(within(group).getByRole('radio', { name: 'Линии' }));

    expect(localStorage.getItem('analytics.matrix.type')).toBe('lines');
  });

  it('легенда категорий и таблица данных с месяцами', async () => {
    renderCompare();

    const legend = await screen.findByRole('list', { name: 'Категории' });

    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['кафе', 'жилье']);
    const data = (await screen.findAllByRole('table', { hidden: true })).find(
      (t) => within(t).queryByText('Месяц') && within(t).queryByText('жилье'),
    )!;
    expect(within(data).getByText('Сентябрь 2026')).toBeInTheDocument();
  });
});
