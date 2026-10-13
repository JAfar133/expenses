import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  harness,
  json,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const location = () => screen.getByTestId('location');
const summaryRequests = () =>
  harness.requests.filter((r) => r.startsWith('/api/analytics/summary'));
const lastSummary = () => summaryRequests().at(-1)!;

type User = ReturnType<typeof renderAnalytics>;

async function openPanel(user: User) {
  await user.click(await screen.findByRole('button', { name: /^Фильтры/ }));
  return screen.findByRole('dialog', { name: 'Фильтры' });
}

/** Opens the panel and one multi-select («Карты», «Категории», …); returns its list. */
async function openList(user: User, label: string) {
  if (!screen.queryByRole('dialog', { name: 'Фильтры' })) await openPanel(user);
  const button = await screen.findByRole('button', { name: new RegExp(`^${label}:`) });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
  return screen.findByRole('group', { name: label });
}

const boxes = (list: HTMLElement) =>
  within(list)
    .getAllByRole('checkbox')
    .map((box) => [
      (box.closest('label') as HTMLElement).textContent,
      (box as HTMLInputElement).checked,
    ]);

async function openPeriod(user: ReturnType<typeof renderAnalytics>) {
  await user.click(await screen.findByRole('button', { name: /^Период:/ }));
  return screen.findByRole('dialog', { name: 'Период' });
}

const periodButton = (text: string) => screen.getByRole('button', { name: `Период: ${text}` });

describe('период', () => {
  it('кнопка с подписью открывает панель; пресет применяется и закрывает её', async () => {
    const user = renderAnalytics();
    expect(await screen.findByRole('button', { name: 'Период: Октябрь 2026' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();

    const panel = await openPeriod(user);
    expect(
      within(panel)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Месяц', '30 дней', '90 дней', 'Год', 'Всё время', 'Свой']);
    await user.click(within(panel).getByRole('radio', { name: '90 дней' }));

    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(periodButton('90 дней')).toBeInTheDocument();
    expect(location()).toHaveTextContent('/analytics?period=90d');
  });

  it('Escape и клик вне панели закрывают её без изменений', async () => {
    const user = renderAnalytics();
    await openPeriod(user);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(periodButton('Октябрь 2026')).toHaveFocus();

    await openPeriod(user);
    await user.click(document.body);
    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(location()).not.toHaveTextContent('period=');
  });

  it('у месяца есть стрелки рядом с кнопкой, у остальных периодов нет', async () => {
    const user = renderAnalytics();
    expect(await screen.findByRole('button', { name: 'Предыдущий месяц' })).toBeInTheDocument();

    await user.click(within(await openPeriod(user)).getByRole('radio', { name: '90 дней' }));

    expect(screen.queryByRole('button', { name: 'Предыдущий месяц' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Следующий месяц' })).toBeNull();
  });

  it('стрелки листают месяц, не открывая панель', async () => {
    const user = renderAnalytics();
    await user.click(await screen.findByRole('button', { name: 'Предыдущий месяц' }));

    expect(periodButton('Сентябрь 2026')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
  });
});

describe('диапазон дат', () => {
  const rangeButton = (text?: string) =>
    screen.queryByRole('button', { name: text ? `Диапазон дат: ${text}` : /^Диапазон дат/ });

  it('для месяца и готовых периодов диапазона дат нет: только для «Свой»', async () => {
    const user = renderAnalytics();
    await screen.findByRole('button', { name: 'Период: Октябрь 2026' });
    expect(rangeButton()).toBeNull();

    for (const period of ['30 дней', '90 дней', 'Год', 'Всё время']) {
      const panel = await openPeriod(user);
      expect(within(panel).queryByRole('button', { name: 'Применить' })).toBeNull();
      await user.click(within(panel).getByRole('radio', { name: period }));
      expect(rangeButton()).toBeNull();
    }
  });

  it('«Свой» из месяца начинается с границ этого месяца; панель остаётся открытой', async () => {
    const user = renderAnalytics();
    const panel = await openPeriod(user);

    await user.click(within(panel).getByRole('radio', { name: 'Свой' }));

    expect(rangeButton('01.10.2026 – 31.10.2026')).toBeInTheDocument();
    expect(location()).toHaveTextContent('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    expect(screen.queryByRole('button', { name: 'Предыдущий месяц' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(periodButton('01.10.2026 – 31.10.2026')).toBeInTheDocument();
  });

  it('«Свой» из 30 дней начинается с этих 30 дней', async () => {
    const user = renderAnalytics('/analytics?period=30d');

    await user.click(within(await openPeriod(user)).getByRole('radio', { name: 'Свой' }));

    expect(rangeButton('16.09.2026 – 15.10.2026')).toBeInTheDocument();
  });

  it('«Свой» из «всё время» берёт последние 30 дней', async () => {
    const user = renderAnalytics('/analytics?period=all');

    await user.click(within(await openPeriod(user)).getByRole('radio', { name: 'Свой' }));

    expect(rangeButton('16.09.2026 – 15.10.2026')).toBeInTheDocument();
  });

  it('свой период из адреса: даты в подписи кнопки и в запросе', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-09-01&to=2026-09-30');

    expect(
      await screen.findByRole('button', { name: 'Период: 01.09.2026 – 30.09.2026' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(summaryRequests()).toContain(
        '/api/analytics/summary?from=2026-09-01&to=2026-09-30&currency=AMD',
      ),
    );
    await openPeriod(user);
    expect(rangeButton('01.09.2026 – 30.09.2026')).toBeInTheDocument();
  });

  async function openCalendar(user: ReturnType<typeof renderAnalytics>) {
    await openPeriod(user);
    await user.click(await screen.findByRole('button', { name: /^Диапазон дат/ }));
    return screen.findByRole('dialog', { name: 'Выбор диапазона дат' });
  }

  it('два нажатия в календаре выбирают начало и конец; период применяется после второго', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    const dialog = await openCalendar(user);
    expect(within(dialog).getByText('Выберите первый и последний день')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)5 октября/ }));

    // While only the start is picked, nothing is applied and the calendar stays open
    expect(within(dialog).getByText('Выберите последний день')).toBeInTheDocument();
    expect(location()).toHaveTextContent('from=2026-10-01&to=2026-10-31');

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)12 октября/ }));

    expect(screen.queryByRole('dialog', { name: 'Выбор диапазона дат' })).toBeNull();
    expect(rangeButton('05.10.2026 – 12.10.2026')).toBeInTheDocument();
    await waitFor(() =>
      expect(location()).toHaveTextContent(
        '/analytics?period=custom&from=2026-10-05&to=2026-10-12',
      ),
    );
    await waitFor(() =>
      expect(lastSummary()).toBe(
        '/api/analytics/summary?from=2026-10-05&to=2026-10-12&currency=AMD',
      ),
    );
  });

  it('если конец выбран раньше начала, границы меняются местами', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    const dialog = await openCalendar(user);

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)12 октября/ }));
    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)5 октября/ }));

    expect(rangeButton('05.10.2026 – 12.10.2026')).toBeInTheDocument();
  });

  it('один день: начало и конец совпадают', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    const dialog = await openCalendar(user);

    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)9 октября/ }));
    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)9 октября/ }));

    expect(rangeButton('09.10.2026 – 09.10.2026')).toBeInTheDocument();
  });

  it('будущие дни выбрать нельзя', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-15');
    const dialog = await openCalendar(user);

    expect(within(dialog).getByRole('button', { name: /(?<!\d)20 октября/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /(?<!\d)14 октября/ })).toBeEnabled();
  });

  it('Escape закрывает только календарь, панель периода остаётся; выбор отбрасывается', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    const dialog = await openCalendar(user);
    await user.click(within(dialog).getByRole('button', { name: /(?<!\d)5 октября/ }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Выбор диапазона дат' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Период' })).toBeInTheDocument();
    expect(rangeButton('01.10.2026 – 31.10.2026')).toBeInTheDocument();
  });

  it('кнопка открывает и закрывает календарь', async () => {
    const user = renderAnalytics('/analytics?period=custom&from=2026-10-01&to=2026-10-31');
    await openPeriod(user);
    const button = await screen.findByRole('button', { name: /^Диапазон дат/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);

    expect(screen.queryByRole('dialog', { name: 'Выбор диапазона дат' })).toBeNull();
  });

  it('некорректный свой период в адресе заменяется месяцем, диапазона дат нет', async () => {
    renderAnalytics('/analytics?period=custom&from=2026-09-30&to=2026-09-01');

    expect(await screen.findByRole('button', { name: 'Период: Октябрь 2026' })).toBeInTheDocument();
    expect(rangeButton()).toBeNull();
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
  it('по умолчанию закрыта, открывается кнопкой; «Показать» и Escape закрывают', async () => {
    const user = renderAnalytics();
    const button = await screen.findByRole('button', { name: /^Фильтры/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Фильтры' })).toBeNull();

    await openPanel(user);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Показать' }));
    expect(screen.queryByRole('dialog', { name: 'Фильтры' })).toBeNull();

    await openPanel(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Фильтры' })).toBeNull();
    expect(button).toHaveFocus();
  });

  it('крестик в шапке закрывает окно и возвращает фокус на кнопку; фон тоже закрывает', async () => {
    const user = renderAnalytics();
    const button = await screen.findByRole('button', { name: /^Фильтры/ });
    const panel = await openPanel(user);
    expect(within(panel).getByRole('heading', { name: 'Фильтры' })).toBeInTheDocument();

    const close = within(panel).getByRole('button', { name: 'Закрыть' });
    expect(close).toHaveAttribute('title', 'Закрыть');
    await user.click(close);

    expect(screen.queryByRole('dialog', { name: 'Фильтры' })).toBeNull();
    expect(button).toHaveFocus();
  });

  it('у окна периода тоже есть крестик', async () => {
    const user = renderAnalytics();
    const panel = await openPeriod(user);

    await user.click(within(panel).getByRole('button', { name: 'Закрыть' }));

    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Период:/ })).toHaveFocus();
  });

  it('без ограничений кнопки показывают «Все …» и ничего лишнего под панелью', async () => {
    const user = renderAnalytics();
    await openPanel(user);

    expect(screen.getByRole('button', { name: 'Карты: Все карты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Кто добавил: Все' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Категории: Все категории' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Валюта ввода: Все' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Включённые фильтры' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Фильтры/ })).not.toHaveTextContent('·');
  });

  it('карты из данных, авторы с именами, валюты и категории из справочников; все отмечены', async () => {
    const user = renderAnalytics();
    await openPanel(user);

    const list = async (label: string) => {
      const group = await openList(user, label);
      await waitFor(() => expect(within(group).queryByText('Нет вариантов')).toBeNull());
      return boxes(group);
    };
    await waitFor(async () =>
      expect(await list('Карты')).toEqual([
        ['Миша', true],
        ['Настя', true],
      ]),
    );
    expect(await list('Кто добавил')).toEqual([
      ['Миша', true],
      ['Настя', true],
    ]);
    expect(await list('Валюта ввода')).toEqual([
      ['AMD', true],
      ['USD', true],
    ]);
    expect(await list('Категории')).toEqual([
      ['кафе', true],
      ['продукты', true],
    ]);
  });

  it('в фильтре все карты группы, в том числе новая без трат и архивная', async () => {
    harness.handlers['/api/analytics/cards'] = () =>
      ok([
        { name: 'Миша', currency: 'AMD', archived: false },
        { name: 'Новая', currency: 'USD', archived: false },
        { name: 'Старая', currency: 'AMD', archived: true },
      ]);
    const user = renderAnalytics();
    const list = await openList(user, 'Карты');

    await waitFor(() =>
      expect(boxes(list).map(([name]) => name)).toEqual(['Миша', 'Новая', 'Старая (архив)']),
    );
  });

  it('снять отметку = выбрать остальные: в адресе и в запросах; вернуть отметку = нет фильтра', async () => {
    const user = renderAnalytics();
    const list = await openList(user, 'Карты');
    const nastya = await within(list).findByRole('checkbox', { name: 'Настя' });

    await user.click(nastya);

    expect(screen.getByRole('button', { name: 'Карты: Миша' })).toBeInTheDocument();
    await waitFor(() =>
      expect(location()).toHaveTextContent('/analytics?card=%D0%9C%D0%B8%D1%88%D0%B0'),
    );
    await waitFor(() => expect(decodeURIComponent(lastSummary())).toContain('cards=Миша&'));
    expect(screen.getByRole('button', { name: /^Фильтры/ })).toHaveTextContent('1');

    await user.click(nastya);

    // Everything ticked again is no filter: not in the address, not counted, not a chip
    await waitFor(() => expect(location()).toHaveTextContent(/^\/analytics$/));
    expect(screen.getByRole('button', { name: 'Карты: Все карты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Фильтры/ })).not.toHaveTextContent('·');
    expect(screen.queryByRole('list', { name: 'Включённые фильтры' })).toBeNull();
  });

  it('последнюю отметку снять нельзя', async () => {
    const user = renderAnalytics('/analytics?card=Миша');
    const list = await openList(user, 'Карты');

    await user.click(await within(list).findByRole('checkbox', { name: 'Миша' }));

    expect(within(list).getByRole('checkbox', { name: 'Миша' })).toBeChecked();
    expect(location()).toHaveTextContent('card=');
  });

  it('отметка нескольких значений одного фильтра и разные фильтры вместе', async () => {
    const user = renderAnalytics(`/analytics?category=${encodeURIComponent('кафе')}`);
    const categories = await openList(user, 'Категории');
    await user.click(await within(categories).findByRole('checkbox', { name: 'продукты' }));
    // Both ticked: no filter
    await waitFor(() => expect(location()).not.toHaveTextContent('category='));

    await user.click(within(categories).getByRole('checkbox', { name: 'продукты' }));
    const currencies = await openList(user, 'Валюта ввода');
    await user.click(within(currencies).getByRole('checkbox', { name: 'AMD' }));

    await waitFor(() => {
      const request = decodeURIComponent(lastSummary());
      expect(request).toContain('categories=кафе');
      expect(request).toContain('currencies=USD');
    });
  });

  it('при более чем 8 значениях у списка есть поиск', async () => {
    harness.handlers['/api/analytics/categories'] = () =>
      ok(Array.from({ length: 9 }, (_, i) => ({ name: `кат${i + 1}`, archived: false })));
    const user = renderAnalytics();
    const list = await openList(user, 'Категории');

    await waitFor(() => expect(within(list).getAllByRole('checkbox')).toHaveLength(9));
    await user.type(within(list).getByRole('searchbox', { name: 'Поиск: Категории' }), 'кат9');

    expect(boxes(list)).toEqual([['кат9', true]]);
  });

  it('у короткого списка поиска нет; «Готово» закрывает список', async () => {
    const user = renderAnalytics();
    const list = await openList(user, 'Категории');
    expect(within(list).queryByRole('searchbox')).toBeNull();

    await user.click(within(list).getByRole('button', { name: 'Готово' }));

    expect(screen.getByRole('button', { name: /^Категории:/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('dialog', { name: 'Фильтры' })).toBeInTheDocument();
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

  it('под кнопкой только активные ограничения чипами, со счётчиком на кнопке', async () => {
    renderAnalytics('/analytics?card=Миша&category=кафе&min=100&deleted=1');

    const button = await screen.findByRole('button', { name: /^Фильтры/ });
    expect(button).toHaveTextContent('4');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const chips = screen.getByRole('list', { name: 'Включённые фильтры' });
    expect(within(chips).getByText('Карты: Миша')).toBeInTheDocument();
    expect(within(chips).getByText('Категории: кафе')).toBeInTheDocument();
    expect(within(chips).getByText('Сумма от 100')).toBeInTheDocument();
    expect(within(chips).getByText('С удалёнными')).toBeInTheDocument();
    expect(within(chips).getAllByRole('button', { name: /^Убрать фильтр/ })).toHaveLength(4);
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
    await screen.findByRole('button', { name: 'Период: Август 2026' });

    await user.click(screen.getByRole('button', { name: 'Сбросить всё' }));

    await waitFor(() => expect(location()).toHaveTextContent(/^\/analytics\?month=2026-08$/));
    expect(screen.queryByRole('list', { name: 'Включённые фильтры' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Период: Август 2026' })).toBeInTheDocument();
  });

  it('«Сбросить» в панели снимает фильтры и оставляет панель открытой; «Показать» закрывает', async () => {
    const user = renderAnalytics('/analytics?card=Миша&deleted=1');
    await openPanel(user);

    await user.click(screen.getByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(location()).toHaveTextContent(/^\/analytics$/));
    expect(screen.getByRole('dialog', { name: 'Фильтры' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /удалённые/ })).not.toBeChecked();
  });

  it('выбранный фильтр, которого нет в справочнике, всё равно виден и снимается', async () => {
    const user = renderAnalytics('/analytics?card=Вася');
    const list = await openList(user, 'Карты');

    expect(await within(list).findByRole('checkbox', { name: 'Вася' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Карты: Вася' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Убрать фильтр: Карты: Вася' }));

    await waitFor(() => expect(within(list).queryByRole('checkbox', { name: 'Вася' })).toBeNull());
  });

  it('фильтры не теряются при переключении вкладок и возвращении', async () => {
    const user = renderAnalytics('/analytics?card=Миша');

    await user.click(await screen.findByRole('link', { name: 'Сравнение месяцев' }));
    expect(location()).toHaveTextContent('/analytics/compare?card=');
    // There is no period on the comparison, but the filters are there
    expect(screen.queryByRole('button', { name: /^Период:/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Фильтры/ })).toHaveTextContent('1');
    await user.click(screen.getByRole('link', { name: 'Обзор' }));

    expect(location()).toHaveTextContent('/analytics?card=');
  });

  it('при ошибке загрузки вариантов фильтры остаются рабочими', async () => {
    harness.handlers['/api/analytics/authors'] = () =>
      json({ success: false, error: { code: 'X', message: 'x' } }, 500);
    const user = renderAnalytics();

    const authors = await openList(user, 'Кто добавил');

    await waitFor(() => expect(within(authors).getByText('Нет вариантов')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Категории:/ })).toBeInTheDocument();
  });
});

describe('архив', () => {
  const archive = () => screen.queryByRole('checkbox', { name: 'Показывать архив' });
  const withArchive = () => {
    harness.handlers['/api/analytics/categories'] = () =>
      ok([
        { name: 'кафе', archived: false },
        { name: 'продукты', archived: false },
        { name: 'старая', archived: true },
      ]);
  };

  it('без архива в группе переключателя нет', async () => {
    const user = renderAnalytics();
    await openPanel(user);

    expect(await screen.findByRole('button', { name: /^Категории:/ })).toBeInTheDocument();
    expect(archive()).toBeNull();
  });

  it('с архивной категорией переключатель есть, выключен, и по умолчанию includeArchived не отправляется', async () => {
    withArchive();
    const user = renderAnalytics();
    await openPanel(user);

    await waitFor(() => expect(archive()).not.toBeNull());
    expect(archive()).not.toBeChecked();
    expect(harness.requests.some((r) => r.includes('includeArchived'))).toBe(false);
  });

  it('с архивной картой переключатель тоже есть', async () => {
    harness.handlers['/api/analytics/cards'] = () =>
      ok([
        { name: 'Миша', currency: 'AMD', archived: false },
        { name: 'Старая', currency: 'AMD', archived: true },
      ]);
    const user = renderAnalytics();
    await openPanel(user);

    await waitFor(() => expect(archive()).not.toBeNull());
  });

  it('включение: includeArchived=true в запросах и archive=1 в адресе; счётчик и чип; сброс выключает', async () => {
    withArchive();
    const user = renderAnalytics();
    await openPanel(user);
    await waitFor(() => expect(archive()).not.toBeNull());

    await user.click(archive()!);

    await waitFor(() => expect(lastSummary()).toContain('includeArchived=true'));
    expect(location()).toHaveTextContent('archive=1');
    expect(archive()).toBeChecked();
    expect(screen.getByRole('button', { name: /^Фильтры/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Убрать фильтр: С архивом' })).toBeInTheDocument();
    for (const path of ['timeseries', 'breakdown']) {
      const last = harness.requests.filter((r) => r.startsWith(`/api/analytics/${path}`)).at(-1)!;
      expect(last).toContain('includeArchived=true');
    }

    await user.click(screen.getByRole('button', { name: 'Сбросить всё' }));

    await waitFor(() => expect(location()).not.toHaveTextContent('archive=1'));
    expect(screen.queryByRole('button', { name: 'Убрать фильтр: С архивом' })).toBeNull();
  });

  it('архивная категория в списке с пометкой «(архив)» и выбирается', async () => {
    withArchive();
    const user = renderAnalytics();
    const list = await openList(user, 'Категории');

    await waitFor(() =>
      expect(boxes(list).map(([name]) => name)).toEqual(['кафе', 'продукты', 'старая (архив)']),
    );

    // Leave only the archived one: uncheck the others
    await user.click(within(list).getByRole('checkbox', { name: 'кафе' }));
    await user.click(within(list).getByRole('checkbox', { name: 'продукты' }));

    await waitFor(() =>
      expect(lastSummary()).toContain('categories=%D1%81%D1%82%D0%B0%D1%80%D0%B0%D1%8F'),
    );
    // Choosing it explicitly does not require the archive switch
    expect(lastSummary()).not.toContain('includeArchived');
  });

  it('скачивание отчёта тоже получает includeArchived=true', async () => {
    withArchive();
    harness.handlers['/api/expenses/export.xlsx'] = () =>
      new Response('x', { headers: { 'Content-Disposition': 'attachment; filename="a.xlsx"' } });
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    const user = renderAnalytics(`/analytics?archive=1`);
    await screen.findByRole('button', { name: 'Скачать Excel' });

    await user.click(screen.getByRole('button', { name: 'Скачать Excel' }));

    await waitFor(() =>
      expect(
        harness.requests.some(
          (r) => r.startsWith('/api/expenses/export.xlsx') && r.includes('includeArchived=true'),
        ),
      ).toBe(true),
    );
  });
});

describe('исключение («все, кроме»)', () => {
  const exclude = (name: string) => screen.findByRole('button', { name: `Исключить: ${name}` });
  const summaryHas = (part: string) => decodeURIComponent(lastSummary()).includes(part);

  it('у каждого значения в четырёх списках есть крестик «Исключить: …» с title', async () => {
    const user = renderAnalytics();
    for (const [label, name] of [
      ['Карты', 'Миша'],
      ['Кто добавил', 'Настя'],
      ['Категории', 'кафе'],
      ['Валюта ввода', 'USD'],
    ] as const) {
      const list = await openList(user, label);
      expect(
        await within(list).findByRole('button', { name: `Исключить: ${name}` }),
      ).toHaveAttribute('title', 'Исключить');
    }
  });

  it('исключение категории: excludeCategories в запросах и в адресе, чип «Кроме», счётчик', async () => {
    const user = renderAnalytics();
    await openList(user, 'Категории');

    await user.click(await exclude('кафе'));

    await waitFor(() => expect(summaryHas('excludeCategories=кафе')).toBe(true));
    expect(location()).toHaveTextContent('exclude_categories=');
    expect(screen.getByRole('button', { name: 'Убрать фильтр: Кроме: кафе' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Фильтры/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Категории: кроме: кафе' })).toBeInTheDocument();
    for (const path of ['timeseries', 'breakdown']) {
      const last = harness.requests.filter((r) => r.startsWith(`/api/analytics/${path}`)).at(-1)!;
      expect(decodeURIComponent(last)).toContain('excludeCategories=кафе');
    }
  });

  it('исключённое значение красное и зачёркнутое, «Вернуть» возвращает его', async () => {
    const user = renderAnalytics();
    await openList(user, 'Категории');
    await user.click(await exclude('продукты'));

    const back = await screen.findByRole('button', { name: 'Вернуть: продукты' });
    expect(back).toHaveAttribute('title', 'Вернуть');
    expect(back).toHaveClass('text-red-700');
    expect(within(back).getByText('продукты')).toHaveClass('line-through');
    expect(screen.queryByRole('button', { name: 'Исключить: продукты' })).toBeNull();

    await user.click(back);

    await waitFor(() => expect(location()).not.toHaveTextContent('exclude_categories'));
    expect(await exclude('продукты')).toBeInTheDocument();
  });

  it('значение не бывает выбранным и исключённым сразу', async () => {
    const user = renderAnalytics(`/analytics?category=${encodeURIComponent('кафе')}`);
    await openList(user, 'Категории');
    await waitFor(() => expect(summaryHas('categories=кафе')).toBe(true));

    // Excluding a selected value drops the selection
    await user.click(await exclude('кафе'));
    await waitFor(() => expect(summaryHas('excludeCategories=кафе')).toBe(true));
    expect(location()).not.toHaveTextContent('category=');

    await user.click(screen.getByRole('button', { name: 'Вернуть: кафе' }));
    await waitFor(() => expect(location()).not.toHaveTextContent('exclude_categories'));
  });

  it('исключённое значение не считается при проверке «все отмечены»', async () => {
    const user = renderAnalytics(`/analytics?exclude_categories=${encodeURIComponent('кафе')}`);
    const list = await openList(user, 'Категории');

    // The only open value is «продукты», it is ticked and cannot be unticked
    expect(await within(list).findByRole('checkbox', { name: 'продукты' })).toBeChecked();
    await user.click(within(list).getByRole('checkbox', { name: 'продукты' }));
    expect(location()).not.toHaveTextContent('category=');
  });

  it('можно сочетать выбор и исключение в разных списках', async () => {
    const user = renderAnalytics();
    const cards = await openList(user, 'Карты');
    await user.click(await within(cards).findByRole('checkbox', { name: 'Настя' }));
    await openList(user, 'Категории');
    await user.click(await exclude('кафе'));

    await waitFor(() => expect(summaryHas('cards=Миша')).toBe(true));
    expect(summaryHas('excludeCategories=кафе')).toBe(true);
    expect(screen.getByRole('button', { name: /^Фильтры/ })).toHaveTextContent('2');
  });

  it('архивные значения тоже можно исключить', async () => {
    harness.handlers['/api/analytics/categories'] = () =>
      ok([
        { name: 'кафе', archived: false },
        { name: 'старая', archived: true },
      ]);
    const user = renderAnalytics();
    await openList(user, 'Категории');

    await user.click(await exclude('старая (архив)'));

    await waitFor(() => expect(summaryHas('excludeCategories=старая')).toBe(true));
  });

  it('чип «Кроме» убирает исключение, «Сбросить всё» — все исключения', async () => {
    const user = renderAnalytics(
      `/analytics?exclude_categories=${encodeURIComponent('кафе')}&exclude_cur=USD`,
    );
    expect(
      await screen.findByRole('button', { name: 'Убрать фильтр: Кроме: кафе' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Убрать фильтр: Кроме: кафе' }));
    await waitFor(() => expect(location()).not.toHaveTextContent('exclude_categories'));
    expect(location()).toHaveTextContent('exclude_cur=USD');

    await user.click(screen.getByRole('button', { name: 'Сбросить всё' }));
    await waitFor(() => expect(location()).not.toHaveTextContent('exclude_cur'));
  });

  it('скачивание отчёта получает исключения', async () => {
    harness.handlers['/api/expenses/export.xlsx'] = () =>
      new Response('x', { headers: { 'Content-Disposition': 'attachment; filename="a.xlsx"' } });
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    const user = renderAnalytics(`/analytics?exclude_cards=${encodeURIComponent('Настя')}`);
    await screen.findByRole('button', { name: 'Скачать Excel' });

    await user.click(screen.getByRole('button', { name: 'Скачать Excel' }));

    await waitFor(() =>
      expect(
        harness.requests
          .map(decodeURIComponent)
          .some(
            (r) => r.startsWith('/api/expenses/export.xlsx') && r.includes('excludeCards=Настя'),
          ),
      ).toBe(true),
    );
  });
});

describe('свой период на телефоне', () => {
  afterEach(() => vi.unstubAllGlobals());
  const phone = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

  it('один инпут диапазона; календарь раскрывается внутри окна, а не попапом', async () => {
    phone();
    const user = renderAnalytics();
    const panel = await openPeriod(user);
    await user.click(within(panel).getByRole('radio', { name: 'Свой' }));

    await user.click(within(panel).getByRole('button', { name: /^Диапазон дат/ }));

    const calendar = within(panel).getByRole('dialog', { name: 'Выбор диапазона дат' });
    expect(calendar).not.toHaveClass('absolute');
    expect(within(panel).queryByLabelText('С')).toBeNull();

    await user.click(within(calendar).getByRole('button', { name: /(?<!\d)5 октября/ }));
    await user.click(within(calendar).getByRole('button', { name: /(?<!\d)12 октября/ }));
    await user.click(within(panel).getByRole('button', { name: 'Применить' }));

    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(periodButton('05.10.2026 – 12.10.2026')).toBeInTheDocument();
    await waitFor(() =>
      expect(lastSummary()).toBe(
        '/api/analytics/summary?from=2026-10-05&to=2026-10-12&currency=AMD',
      ),
    );
  });

  it('пресеты на телефоне применяются сразу и закрывают окно', async () => {
    phone();
    const user = renderAnalytics();

    await user.click(within(await openPeriod(user)).getByRole('radio', { name: 'Год' }));

    expect(screen.queryByRole('dialog', { name: 'Период' })).toBeNull();
    expect(periodButton('Год')).toBeInTheDocument();
  });

  it('на десктопе календарь — попап поверх окна', async () => {
    const user = renderAnalytics();
    const panel = await openPeriod(user);
    await user.click(within(panel).getByRole('radio', { name: 'Свой' }));
    await user.click(within(panel).getByRole('button', { name: /^Диапазон дат/ }));

    expect(within(panel).getByRole('dialog', { name: 'Выбор диапазона дат' })).toHaveClass(
      'absolute',
    );
  });
});
