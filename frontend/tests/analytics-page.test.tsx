import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  harness,
  json,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
  stats,
  summary,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const tile = (label: string) =>
  screen.getByText(label, { selector: 'div' }).parentElement as HTMLElement;

describe('обзор месяца', () => {
  it('по умолчанию показывает текущий месяц и запрашивает его границы', async () => {
    renderAnalytics();

    expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    await waitFor(() =>
      expect(harness.requests.some((r) => r.startsWith('/api/analytics/summary'))).toBe(true),
    );
    const summaryRequest = harness.requests.find((r) => r.startsWith('/api/analytics/summary'))!;
    expect(summaryRequest).toBe('/api/analytics/summary?from=2026-10-01&to=2026-10-31');
    expect(harness.requests).toContain(
      '/api/analytics/timeseries?from=2026-10-01&to=2026-10-31&granularity=day',
    );
    expect(harness.requests).toContain(
      '/api/analytics/breakdown?from=2026-10-01&to=2026-10-31&by=category',
    );
  });

  it('плитки: итог, расход в день, число операций, средний чек и самая крупная операция', async () => {
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    expect(tile('В день')).toHaveTextContent('140 AMD');
    expect(tile('Операций')).toHaveTextContent('5');
    expect(tile('Средний чек')).toHaveTextContent('420 AMD');
    expect(tile('Самая крупная')).toHaveTextContent('700 AMD');
  });

  it('показывает изменение к предыдущим дням: рост и снижение словами, не только цветом', async () => {
    renderAnalytics();

    await waitFor(() =>
      expect(tile('Потрачено')).toHaveTextContent('больше на 110% к предыдущим 15 дн.'),
    );
    expect(tile('В день')).toHaveTextContent('больше на 110%');
    expect(tile('Операций')).toHaveTextContent('больше на 25%');
  });

  it('без предыдущего периода изменение не показывается', async () => {
    harness.handlers['/api/analytics/summary'] = () => ok({ current: stats(), previous: null });
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    expect(tile('Потрачено')).not.toHaveTextContent('больше');
  });
});

describe('переключение месяца', () => {
  it('«назад» открывает прошлый месяц и запоминает его в адресе', async () => {
    const user = renderAnalytics();
    await screen.findByRole('heading', { name: 'Октябрь 2026' });

    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));

    expect(await screen.findByRole('heading', { name: 'Сентябрь 2026' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/analytics?month=2026-09');
    await waitFor(() =>
      expect(harness.requests).toContain('/api/analytics/summary?from=2026-09-01&to=2026-09-30'),
    );
  });

  it('дальше текущего месяца переключать нельзя', async () => {
    renderAnalytics();
    await screen.findByRole('heading', { name: 'Октябрь 2026' });

    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
  });

  it('из прошлого месяца можно вернуться, адрес снова без параметра', async () => {
    const user = renderAnalytics('/analytics?month=2026-08');
    await screen.findByRole('heading', { name: 'Август 2026' });

    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));

    expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/analytics$/);
  });

  it.each(['2026-13', 'abc', '2099-01'])(
    'некорректный или будущий месяц %s заменяется текущим',
    async (month) => {
      renderAnalytics(`/analytics?month=${month}`);

      expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    },
  );
});

describe('состояния', () => {
  it('месяц без расходов: нули и сообщение вместо графиков', async () => {
    harness.handlers['/api/analytics/summary'] = () =>
      ok({ current: stats({ total: 0, count: 0, perDay: 0, average: 0, max: 0 }), previous: null });
    harness.handlers['/api/analytics/timeseries'] = () =>
      ok([{ period: '2026-10-01', total: 0, count: 0 }]);
    harness.handlers['/api/analytics/breakdown'] = () => ok([]);
    renderAnalytics();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('0 AMD'));
    // График по дням, график категорий и карточка наименований
    expect(await screen.findAllByText('За выбранный период расходов нет')).toHaveLength(3);
  });

  it('ошибка загрузки: сообщение и повтор', async () => {
    let failing = true;
    harness.handlers['/api/analytics/summary'] = () =>
      failing ? json({ success: false, error: { code: 'X', message: 'x' } }, 500) : ok(summary);
    const user = renderAnalytics();

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные');

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
  });
});

describe('вид графиков', () => {
  it('у графика по дням три вида и режим «накопительно»; выбор запоминается', async () => {
    const user = renderAnalytics();
    const group = await screen
      .findByRole('radiogroup', { name: 'Вид графика', description: '' })
      .catch(() => null);
    expect(group).toBeNull(); // два одноимённых переключателя: ниже ищем конкретный

    const switches = screen.getAllByRole('radiogroup', { name: 'Вид графика' });
    const dailyKinds = within(switches[0]!)
      .getAllByRole('radio')
      .map((r) => r.textContent);
    expect(dailyKinds).toEqual(['Столбики', 'Линия', 'Область']);
    expect(within(switches[0]!).getByRole('radio', { name: 'Столбики' })).toBeChecked();

    await user.click(within(switches[0]!).getByRole('radio', { name: 'Линия' }));

    expect(within(switches[0]!).getByRole('radio', { name: 'Линия' })).toBeChecked();
    expect(localStorage.getItem('analytics.daily.type')).toBe('line');
  });

  it('у категорий четыре вида, среди них кольцо и круг', async () => {
    renderAnalytics();
    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    const kinds = within(switches[1]!)
      .getAllByRole('radio')
      .map((r) => r.textContent);

    expect(kinds).toEqual(['Полосы', 'Столбики', 'Кольцо', 'Круг']);
  });

  it('кольцо показывает легенду с долями и суммами и общий итог', async () => {
    const user = renderAnalytics();
    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    await user.click(within(switches[1]!).getByRole('radio', { name: 'Кольцо' }));

    expect(localStorage.getItem('analytics.category.type')).toBe('donut');
    const legend = await screen.findByText('кафе', { selector: 'li span' });
    const item = legend.closest('li') as HTMLElement;
    expect(item).toHaveTextContent('71%');
    expect(item).toHaveTextContent('1 500');
    expect(screen.getByText('Всего')).toBeInTheDocument();
  });

  it('сохранённый вид применяется при следующем открытии', async () => {
    localStorage.setItem('analytics.category.type', 'pie');
    renderAnalytics();

    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    expect(within(switches[1]!).getByRole('radio', { name: 'Круг' })).toBeChecked();
    expect(screen.queryByText('Всего')).toBeNull();
  });

  it('неизвестное сохранённое значение игнорируется', async () => {
    localStorage.setItem('analytics.daily.type', 'radar');
    renderAnalytics();

    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    expect(within(switches[0]!).getByRole('radio', { name: 'Столбики' })).toBeChecked();
  });
});

describe('таблицы с данными графиков', () => {
  it('категории: сумма, доля и число операций', async () => {
    renderAnalytics();

    const tables = await screen.findAllByRole('table', { hidden: true });
    const categoryTable = tables.find((t) => within(t).queryByText('Категория', { exact: false }))!;

    expect(within(categoryTable).getByText('кафе')).toBeInTheDocument();
    expect(within(categoryTable).getByText('71,4%')).toBeInTheDocument();
    expect(within(categoryTable).getByText('1 500')).toBeInTheDocument();
  });

  it('по дням: подписи дат и суммы, в том числе пустые дни', async () => {
    renderAnalytics();

    const tables = await screen.findAllByRole('table', { hidden: true });
    const dailyTable = tables.find((t) => within(t).queryByText('День'))!;

    expect(within(dailyTable).getByText('четверг, 1 октября')).toBeInTheDocument();
    expect(within(dailyTable).getByText('суббота, 10 октября')).toBeInTheDocument();
    expect(within(dailyTable).getAllByRole('row')).toHaveLength(4);
  });
});
