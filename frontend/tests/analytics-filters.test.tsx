import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  harness,
  json,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const location = () => screen.getByTestId('location');
const summaryRequests = () =>
  harness.requests.filter((r) => r.startsWith('/api/analytics/summary'));
const lastSummary = () => summaryRequests().at(-1)!;

async function openPanel(user: ReturnType<typeof renderAnalytics>) {
  await user.click(await screen.findByRole('button', { name: /^Фильтры/ }));
  return screen.findByRole('group', { name: 'Карты' });
}

describe('диапазон дат', () => {
  const rangeButton = (text?: string) =>
    screen.queryByRole('button', { name: text ? `Диапазон дат: ${text}` : /^Диапазон дат/ });

  it('для месяца и готовых периодов диапазона дат нет: только для «Свой»', async () => {
    const user = renderAnalytics();
    await screen.findByRole('heading', { name: 'Октябрь 2026' });
    expect(rangeButton()).toBeNull();
    expect(screen.queryByLabelText('Начало периода')).toBeNull();

    for (const period of ['30 дней', '90 дней', 'Год', 'Всё время']) {
      await user.click(screen.getByRole('radio', { name: period }));
      expect(rangeButton()).toBeNull();
    }
  });

  it('«Свой» из месяца начинается с границ этого месяца', async () => {
    const user = renderAnalytics();
    await screen.findByRole('heading', { name: 'Октябрь 2026' });

    await user.click(screen.getByRole('radio', { name: 'Свой' }));

    expect(rangeButton('01.10.2026 – 31.10.2026')).toBeInTheDocument();
    expect(location()).toHaveTextContent('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    // Переключателя месяца у своего периода нет
    expect(screen.queryByRole('button', { name: 'Предыдущий месяц' })).toBeNull();
  });

  it('«Свой» из 30 дней начинается с этих 30 дней', async () => {
    const user = renderAnalytics('/analytics?period=30d');
    await screen.findByRole('radio', { name: 'Свой' });

    await user.click(screen.getByRole('radio', { name: 'Свой' }));

    expect(rangeButton('16.09.2026 – 15.10.2026')).toBeInTheDocument();
  });

  it('«Свой» из «всё время» берёт последние 30 дней', async () => {
    const user = renderAnalytics('/analytics?period=all');
    await screen.findByRole('radio', { name: 'Свой' });

    await user.click(screen.getByRole('radio', { name: 'Свой' }));

    expect(rangeButton('16.09.2026 – 15.10.2026')).toBeInTheDocument();
  });

  it('свой период из адреса показывает свои даты и запрашивает их', async () => {
    renderAnalytics('/analytics?period=custom&from=2026-09-01&to=2026-09-30');

    expect(
      await screen.findByRole('button', { name: 'Диапазон дат: 01.09.2026 – 30.09.2026' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(summaryRequests()).toContain('/api/analytics/summary?from=2026-09-01&to=2026-09-30'),
    );
  });

  it('два нажатия в календаре выбирают начало и конец; период применяется после второго', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    await user.click(await screen.findByRole('button', { name: /^Диапазон дат/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Выбор диапазона дат' });
    expect(within(dialog).getByText('Выберите первый и последний день')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)5 октября/ }));

    // Пока выбрано только начало, ничего не применяется и календарь открыт
    expect(within(dialog).getByText('Выберите последний день')).toBeInTheDocument();
    expect(location()).toHaveTextContent('from=2026-10-01&to=2026-10-31');

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)12 октября/ }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rangeButton('05.10.2026 – 12.10.2026')).toBeInTheDocument();
    await waitFor(() =>
      expect(location()).toHaveTextContent(
        '/analytics?period=custom&from=2026-10-05&to=2026-10-12',
      ),
    );
    await waitFor(() =>
      expect(lastSummary()).toBe('/api/analytics/summary?from=2026-10-05&to=2026-10-12'),
    );
  });

  it('если конец выбран раньше начала, границы меняются местами', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    await user.click(await screen.findByRole('button', { name: /^Диапазон дат/ }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)12 октября/ }));
    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)5 октября/ }));

    expect(rangeButton('05.10.2026 – 12.10.2026')).toBeInTheDocument();
  });

  it('один день: начало и конец совпадают', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    await user.click(await screen.findByRole('button', { name: /^Диапазон дат/ }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)9 октября/ }));
    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)9 октября/ }));

    expect(rangeButton('09.10.2026 – 09.10.2026')).toBeInTheDocument();
  });

  it('будущие дни выбрать нельзя', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-15');
    await user.click(await screen.findByRole('button', { name: /^Диапазон дат/ }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: /(?<!\d)20 октября/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /(?<!\d)14 октября/ })).toBeEnabled();
  });

  it('Escape закрывает календарь без изменений; незаконченный выбор отбрасывается', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    await user.click(await screen.findByRole('button', { name: /^Диапазон дат/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /(?<!\d)5 октября/ }),
    );

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rangeButton('01.10.2026 – 31.10.2026')).toBeInTheDocument();
  });

  it('кнопка открывает и закрывает календарь', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    const button = await screen.findByRole('button', { name: /^Диапазон дат/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('некорректный свой период в адресе заменяется месяцем, диапазона дат нет', async () => {
    renderAnalytics('/analytics?period=custom&from=2026-09-30&to=2026-09-01');

    expect(await screen.findByRole('heading', { name: 'Октябрь 2026' })).toBeInTheDocument();
    expect(rangeButton()).toBeNull();
  });

  it('у месяца есть переключатель, у остальных периодов нет', async () => {
    const user = renderAnalytics();
    expect(await screen.findByRole('button', { name: 'Предыдущий месяц' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '90 дней' }));

    expect(screen.queryByRole('button', { name: 'Предыдущий месяц' })).toBeNull();
  });
});

describe('график по времени подстраивается под период', () => {
  const timeseries = () =>
    harness.requests.filter((r) => r.startsWith('/api/analytics/timeseries'));

  it.each([
    ['', 'day'],
    ['period=30d', 'day'],
    ['period=90d', 'week'],
    ['period=year', 'week'],
    ['period=all', 'month'],
  ])('%s → шаг %s', async (query, granularity) => {
    renderAnalytics(`/analytics?${query}`);

    await waitFor(() => expect(timeseries().length).toBeGreaterThan(0));

    expect(timeseries().at(-1)).toContain(`granularity=${granularity}`);
  });

  it('заголовок графика называет шаг', async () => {
    renderAnalytics('/analytics?period=90d');

    expect(await screen.findByRole('heading', { name: 'Расходы по неделям' })).toBeInTheDocument();
  });
});

describe('панель фильтров', () => {
  it('по умолчанию свёрнута, раскрывается кнопкой и запоминает выбор', async () => {
    const user = renderAnalytics();
    const button = await screen.findByRole('button', { name: /^Фильтры/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Карты' })).toBeNull();

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('group', { name: 'Карты' })).toBeInTheDocument();
    expect(localStorage.getItem('analytics.filters.panel')).toBe('open');
  });

  it('карты из данных, авторы с именами, валюты из справочника, категории из справочника', async () => {
    const user = renderAnalytics();
    await openPanel(user);

    const names = (group: string) =>
      within(screen.getByRole('group', { name: group }))
        .getAllByRole('button')
        .map((b) => b.textContent);
    await waitFor(() => expect(names('Карты')).toEqual(['Миша', 'Настя']));
    expect(names('Кто добавил')).toEqual(['Миша', 'Настя']);
    expect(names('Валюта ввода')).toEqual(['AMD', 'USD']);
    expect(names('Категории')).toEqual(['кафе', 'продукты']);
  });

  it('карта: выбор попадает в адрес и в запросы, повторное нажатие снимает', async () => {
    const user = renderAnalytics();
    const cards = await openPanel(user);
    const misha = await within(cards).findByRole('button', { name: 'Миша' });

    await user.click(misha);

    expect(misha).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(location()).toHaveTextContent('/analytics?card=%D0%9C%D0%B8%D1%88%D0%B0'),
    );
    await waitFor(() =>
      expect(lastSummary()).toBe(
        `/analytics/summary?from=2026-10-01&to=2026-10-31&cards=${encodeURIComponent('Миша')}`.replace(
          '/analytics',
          '/api/analytics',
        ),
      ),
    );

    await user.click(misha);

    expect(misha).toHaveAttribute('aria-pressed', 'false');
    // Запрос без карты уже есть в кэше, поэтому проверяем адрес страницы
    await waitFor(() => expect(location()).toHaveTextContent(/^\/analytics$/));
  });

  it('несколько значений одного фильтра и разные фильтры вместе', async () => {
    const user = renderAnalytics();
    await openPanel(user);

    await user.click(
      await within(screen.getByRole('group', { name: 'Категории' })).findByRole('button', {
        name: 'кафе',
      }),
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Категории' })).getByRole('button', {
        name: 'продукты',
      }),
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Валюта ввода' })).getByRole('button', {
        name: 'USD',
      }),
    );

    await waitFor(() => {
      const request = decodeURIComponent(lastSummary());
      expect(request).toContain('categories=кафе&categories=продукты');
      expect(request).toContain('currencies=USD');
    });
  });

  it('поиск по наименованию отправляется после паузы, а не на каждую букву', async () => {
    const user = renderAnalytics();
    await openPanel(user);
    const before = summaryRequests().length;

    await user.type(screen.getByLabelText('Поиск по наименованию'), 'латте');

    expect(summaryRequests()).toHaveLength(before);
    await waitFor(() => expect(decodeURIComponent(lastSummary())).toContain('q=латте'), {
      timeout: 2000,
    });
    expect(location()).toHaveTextContent('q=%D0%BB%D0%B0%D1%82%D1%82%D0%B5');
    // Одно обращение на всё слово, а не шесть
    expect(summaryRequests().filter((r) => r.includes('q=')).length).toBeLessThanOrEqual(2);
  });

  it('границы суммы и «показывать удалённые»', async () => {
    const user = renderAnalytics();
    await openPanel(user);

    await user.type(screen.getByLabelText('Сумма от'), '100');
    await user.type(screen.getByLabelText('Сумма до'), '900');
    await user.click(screen.getByRole('checkbox', { name: /удалённые/ }));

    await waitFor(
      () => {
        const request = lastSummary();
        expect(request).toContain('minAmount=100');
        expect(request).toContain('maxAmount=900');
        expect(request).toContain('includeDeleted=true');
      },
      { timeout: 2000 },
    );
  });

  it('счётчик на кнопке и чипы включённых фильтров видны и в свёрнутой панели', async () => {
    renderAnalytics('/analytics?card=Миша&category=кафе&min=100&deleted=1');

    const button = await screen.findByRole('button', { name: /^Фильтры/ });
    expect(button).toHaveTextContent('4');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const chips = screen.getByRole('list', { name: 'Включённые фильтры' });
    expect(within(chips).getByText('Карты: Миша')).toBeInTheDocument();
    expect(within(chips).getByText('Категории: кафе')).toBeInTheDocument();
    expect(within(chips).getByText('Сумма от 100')).toBeInTheDocument();
    expect(within(chips).getByText('С удалёнными')).toBeInTheDocument();
  });

  it('чип снимает свой фильтр одним нажатием', async () => {
    const user = renderAnalytics('/analytics?card=Миша&category=кафе');
    await user.click(await screen.findByRole('button', { name: 'Убрать фильтр: Карты: Миша' }));

    expect(screen.queryByText('Карты: Миша')).toBeNull();
    expect(screen.getByText('Категории: кафе')).toBeInTheDocument();
    await waitFor(() => expect(location()).toHaveTextContent('category='));
    expect(location()).not.toHaveTextContent('card=');
  });

  it('«Сбросить всё» убирает фильтры, но оставляет период', async () => {
    const user = renderAnalytics('/analytics?month=2026-08&card=Миша&q=латте&deleted=1');
    await screen.findByRole('heading', { name: 'Август 2026' });

    await user.click(screen.getByRole('button', { name: 'Сбросить всё' }));

    await waitFor(() => expect(location()).toHaveTextContent(/^\/analytics\?month=2026-08$/));
    expect(screen.queryByRole('list', { name: 'Включённые фильтры' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Август 2026' })).toBeInTheDocument();
  });

  it('выбранный фильтр, которого нет в справочнике, всё равно виден и снимается', async () => {
    const user = renderAnalytics('/analytics?card=Вася');
    await openPanel(user);

    const chip = await within(screen.getByRole('group', { name: 'Карты' })).findByRole('button', {
      name: 'Вася',
    });

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    // Снятое значение не из справочника больше не показывается
    expect(
      within(screen.getByRole('group', { name: 'Карты' })).queryByRole('button', { name: 'Вася' }),
    ).toBeNull();
  });

  it('фильтры не теряются при переключении вкладок и возвращении', async () => {
    const user = renderAnalytics('/analytics?card=Миша');

    await user.click(await screen.findByRole('link', { name: 'Сравнение месяцев' }));
    expect(location()).toHaveTextContent('/analytics/compare?card=');
    await user.click(screen.getByRole('link', { name: 'Обзор' }));

    expect(location()).toHaveTextContent('/analytics?card=');
  });

  it('при ошибке загрузки вариантов фильтры остаются рабочими', async () => {
    harness.handlers['/api/analytics/authors'] = () =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500);
    const user = renderAnalytics();

    await openPanel(user);

    await waitFor(() => expect(screen.getAllByText('Нет вариантов')).toHaveLength(1));
    // Остальные фильтры работают
    expect(screen.getByRole('group', { name: 'Категории' })).toBeInTheDocument();
  });
});
