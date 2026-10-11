import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '../src/features/analytics/pages/AnalyticsPage.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });

const stats = (overrides: Record<string, number> = {}) => ({
  total: 2100,
  count: 5,
  average: 420,
  median: 400,
  max: 700,
  activeDays: 3,
  firstDate: '2026-10-01',
  lastDate: '2026-10-10',
  days: 15,
  perDay: 140,
  ...overrides,
});

const summary = {
  current: stats(),
  previous: stats({ total: 1000, count: 4, perDay: 66.67 }),
};

const daily = [
  { period: '2026-10-01', total: 800, count: 2 },
  { period: '2026-10-02', total: 0, count: 0 },
  { period: '2026-10-10', total: 1300, count: 3 },
];

const categories = [
  { key: 'кафе', total: 1500, count: 3, average: 500 },
  { key: 'продукты', total: 600, count: 2, average: 300 },
];

type Handler = (url: URL) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let requests: string[];

beforeEach(() => {
  // «Сегодня» фиксируем: от него зависит текущий месяц
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
  localStorage.clear();

  requests = [];
  handlers = {
    '/api/analytics/summary': () => ok(summary),
    '/api/analytics/timeseries': () => ok(daily),
    '/api/analytics/breakdown': () => ok(categories),
    '/api/config': () => ok({ currency: 'AMD' }),
    '/api/categories': () => ok(['кафе', 'продукты']),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      const url = new URL(input, 'http://localhost');
      const handler = handlers[url.pathname];
      if (!handler) throw new Error(`Unexpected request: ${input}`);
      return handler(url);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderPage(path = '/analytics') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="analytics" element={<AnalyticsPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

const tile = (label: string) =>
  screen.getByText(label, { selector: 'div' }).parentElement as HTMLElement;

describe('обзор месяца', () => {
  it('по умолчанию показывает текущий месяц и запрашивает его границы', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    await waitFor(() =>
      expect(requests.some((r) => r.startsWith('/api/analytics/summary'))).toBe(true),
    );
    const summaryRequest = requests.find((r) => r.startsWith('/api/analytics/summary'))!;
    expect(summaryRequest).toBe('/api/analytics/summary?from=2026-10-01&to=2026-10-31');
    expect(requests).toContain(
      '/api/analytics/timeseries?from=2026-10-01&to=2026-10-31&granularity=day',
    );
    expect(requests).toContain(
      '/api/analytics/breakdown?from=2026-10-01&to=2026-10-31&by=category',
    );
  });

  it('плитки: итог, расход в день, число операций, средний чек и самая крупная операция', async () => {
    renderPage();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    expect(tile('В день')).toHaveTextContent('140 AMD');
    expect(tile('Операций')).toHaveTextContent('5');
    expect(tile('Средний чек')).toHaveTextContent('420 AMD');
    expect(tile('Самая крупная')).toHaveTextContent('700 AMD');
  });

  it('показывает изменение к предыдущим дням: рост и снижение словами, не только цветом', async () => {
    renderPage();

    await waitFor(() =>
      expect(tile('Потрачено')).toHaveTextContent('больше на 110% к предыдущим 15 дн.'),
    );
    expect(tile('В день')).toHaveTextContent('больше на 110%');
    expect(tile('Операций')).toHaveTextContent('больше на 25%');
  });

  it('без предыдущего периода изменение не показывается', async () => {
    handlers['/api/analytics/summary'] = () => ok({ current: stats(), previous: null });
    renderPage();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
    expect(tile('Потрачено')).not.toHaveTextContent('больше');
  });
});

describe('переключение месяца', () => {
  it('«назад» открывает прошлый месяц и запоминает его в адресе', async () => {
    const user = renderPage();
    await screen.findByRole('heading', { name: 'Октябрь 2026' });

    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));

    expect(await screen.findByRole('heading', { name: 'Сентябрь 2026' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/analytics?month=2026-09');
    await waitFor(() =>
      expect(requests).toContain('/api/analytics/summary?from=2026-09-01&to=2026-09-30'),
    );
  });

  it('дальше текущего месяца переключать нельзя', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Октябрь 2026' });

    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
  });

  it('из прошлого месяца можно вернуться, адрес снова без параметра', async () => {
    const user = renderPage('/analytics?month=2026-08');
    await screen.findByRole('heading', { name: 'Август 2026' });

    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));

    expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/analytics$/);
  });

  it.each(['2026-13', 'abc', '2099-01'])(
    'некорректный или будущий месяц %s заменяется текущим',
    async (month) => {
      renderPage(`/analytics?month=${month}`);

      expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    },
  );
});

describe('состояния', () => {
  it('месяц без расходов: нули и сообщение вместо графиков', async () => {
    handlers['/api/analytics/summary'] = () =>
      ok({ current: stats({ total: 0, count: 0, perDay: 0, average: 0, max: 0 }), previous: null });
    handlers['/api/analytics/timeseries'] = () =>
      ok([{ period: '2026-10-01', total: 0, count: 0 }]);
    handlers['/api/analytics/breakdown'] = () => ok([]);
    renderPage();

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('0 AMD'));
    expect(await screen.findAllByText('За выбранный период расходов нет')).toHaveLength(2);
  });

  it('ошибка загрузки: сообщение и повтор', async () => {
    let failing = true;
    handlers['/api/analytics/summary'] = () =>
      failing ? json({ success: false, error: { code: 'X', message: 'x' } }, 500) : ok(summary);
    const user = renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные');

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(tile('Потрачено')).toHaveTextContent('2 100 AMD'));
  });
});

describe('вид графиков', () => {
  it('у графика по дням три вида и режим «накопительно»; выбор запоминается', async () => {
    const user = renderPage();
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
    renderPage();
    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    const kinds = within(switches[1]!)
      .getAllByRole('radio')
      .map((r) => r.textContent);

    expect(kinds).toEqual(['Полосы', 'Столбики', 'Кольцо', 'Круг']);
  });

  it('кольцо показывает легенду с долями и суммами и общий итог', async () => {
    const user = renderPage();
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
    renderPage();

    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    expect(within(switches[1]!).getByRole('radio', { name: 'Круг' })).toBeChecked();
    expect(screen.queryByText('Всего')).toBeNull();
  });

  it('неизвестное сохранённое значение игнорируется', async () => {
    localStorage.setItem('analytics.daily.type', 'radar');
    renderPage();

    const switches = await screen.findAllByRole('radiogroup', { name: 'Вид графика' });

    expect(within(switches[0]!).getByRole('radio', { name: 'Столбики' })).toBeChecked();
  });
});

describe('таблицы с данными графиков', () => {
  it('категории: сумма, доля и число операций', async () => {
    renderPage();

    const tables = await screen.findAllByRole('table', { hidden: true });
    const categoryTable = tables.find((t) => within(t).queryByText('Категория', { exact: false }))!;

    expect(within(categoryTable).getByText('кафе')).toBeInTheDocument();
    expect(within(categoryTable).getByText('71,4%')).toBeInTheDocument();
    expect(within(categoryTable).getByText('1 500')).toBeInTheDocument();
  });

  it('по дням: подписи дат и суммы, в том числе пустые дни', async () => {
    renderPage();

    const tables = await screen.findAllByRole('table', { hidden: true });
    const dailyTable = tables.find((t) => within(t).queryByText('День'))!;

    expect(within(dailyTable).getByText('четверг, 1 октября')).toBeInTheDocument();
    expect(within(dailyTable).getByText('суббота, 10 октября')).toBeInTheDocument();
    expect(within(dailyTable).getAllByRole('row')).toHaveLength(4);
  });
});
