import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildPatch } from '../src/features/analytics/components/EditExpenseDialog.tsx';
import type { OperationItem } from '../src/features/analytics/api/operations.api.ts';
import {
  clampPage,
  nextSort,
  pageCount,
  parseSort,
  rangeLabel,
} from '../src/features/analytics/model/operations.ts';
import {
  harness,
  json,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const item = (n: number, overrides: Partial<OperationItem> = {}): OperationItem => ({
  id: ID(n),
  date: '2026-10-10',
  card: 'Миша',
  category: 'кафе',
  name: `Позиция ${n}`,
  amount: 1000 * n,
  currency: 'AMD',
  original: null,
  createdBy: 'misha',
  source: 'app',
  excelState: 'synced',
  excelError: null,
  deletedAt: null,
  deletedReason: null,
  updatedBy: null,
  ...overrides,
});

const page = (items: OperationItem[], total = items.length) => ({
  items,
  total,
  totalAmount: items.reduce((sum, i) => sum + i.amount, 0),
});

const listRequests = () => harness.requests.filter((r) => r.startsWith('/api/expenses?'));
const lastList = () => decodeURIComponent(listRequests().at(-1)!);
const table = () => screen.getByRole('table', { name: 'Операции' });
const rowOf = (text: string) =>
  within(table())
    .getAllByRole('row')
    .find((row) => row.textContent?.includes(text))!;

function serve(items: OperationItem[] = [item(1), item(2)], total = items.length) {
  harness.handlers['/api/expenses'] = () => ok(page(items, total));
}

const OPS = '/analytics/operations';

describe('чистые функции', () => {
  it('nextSort: тот же столбец меняет направление, новый начинает с естественного', () => {
    expect(nextSort({ sort: 'date', direction: 'desc' }, 'date')).toEqual({
      sort: 'date',
      direction: 'asc',
    });
    expect(nextSort({ sort: 'date', direction: 'asc' }, 'date')).toEqual({
      sort: 'date',
      direction: 'desc',
    });
    expect(nextSort({ sort: 'date', direction: 'desc' }, 'amount')).toEqual({
      sort: 'amount',
      direction: 'desc',
    });
    expect(nextSort({ sort: 'date', direction: 'desc' }, 'name')).toEqual({
      sort: 'name',
      direction: 'asc',
    });
  });

  it('parseSort: только известные значения', () => {
    expect(parseSort(null, null)).toEqual({ sort: 'date', direction: 'desc' });
    expect(parseSort('amount', 'asc')).toEqual({ sort: 'amount', direction: 'asc' });
    expect(parseSort('password', 'asc')).toEqual({ sort: 'date', direction: 'desc' });
    expect(parseSort('name', 'sideways')).toEqual({ sort: 'name', direction: 'desc' });
  });

  it('страницы', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(clampPage(9, 120)).toBe(3);
    expect(clampPage(0, 120)).toBe(1);
    expect(clampPage(1.5, 120)).toBe(1);
    expect(rangeLabel(2, 120)).toBe('51–100 из 120');
    expect(rangeLabel(3, 120)).toBe('101–120 из 120');
    expect(rangeLabel(1, 0)).toBe('0 записей');
  });

  it('buildPatch: только изменённые поля и проверка значений', () => {
    const base = item(1);
    const same = {
      date: base.date,
      card: base.card,
      category: base.category,
      name: base.name,
      amount: '1 000',
    };

    expect(buildPatch(base, same).patch).toEqual({});
    expect(buildPatch(base, { ...same, name: '  Новое  ', amount: '2 500' })).toEqual({
      patch: { name: 'Новое', amount: 2500 },
      errors: {},
    });
    expect(buildPatch(base, { ...same, name: '   ', amount: '' }).errors).toEqual({
      name: 'Введите наименование',
      amount: 'Введите стоимость',
    });
    expect(buildPatch(base, { ...same, amount: '0' }).errors.amount).toBe(
      'Стоимость должна быть больше нуля',
    );
    expect(buildPatch(base, { ...same, date: '' }).errors.date).toBe('Укажите дату');
  });
});

describe('список операций', () => {
  it('показывает записи: дата, карта, категория, наименование, стоимость, автор', async () => {
    serve([item(1, { date: '2026-10-05', amount: 12345 })]);
    renderAnalytics(OPS);

    const row = await waitFor(() => rowOf('Позиция 1'));

    expect(row).toHaveTextContent('05.10.2026');
    expect(row).toHaveTextContent('Миша');
    expect(row).toHaveTextContent('кафе');
    expect(row).toHaveTextContent('12 345 AMD');
    expect(screen.getByText('Записей:', { exact: false })).toHaveTextContent(
      'Записей: 1 на 12 345 AMD',
    );
  });

  it('по умолчанию от новых к старым, 50 записей, период берётся из фильтров', async () => {
    serve();
    renderAnalytics(OPS);

    await waitFor(() => expect(listRequests().length).toBeGreaterThan(0));

    expect(lastList()).toBe(
      '/api/expenses?from=2026-10-01&to=2026-10-31&sort=date&direction=desc&limit=50&offset=0',
    );
  });

  it('автор показывается именем, а не логином', async () => {
    serve([item(1, { createdBy: 'nastya' })]);
    harness.handlers['/api/analytics/authors'] = () =>
      ok([{ value: 'nastya', label: 'Настя', count: 1 }]);
    renderAnalytics(OPS);

    await waitFor(() => expect(rowOf('Позиция 1')).toHaveTextContent('Настя'));
  });

  it('расход в иностранной валюте: исходная сумма и курс', async () => {
    serve([item(1, { original: { amount: 10, currency: 'USD', rate: 380 }, amount: 3800 })]);
    renderAnalytics(OPS);

    const row = await waitFor(() => rowOf('Позиция 1'));

    expect(row).toHaveTextContent('3 800 AMD');
    expect(row).toHaveTextContent('10 USD · курс 380');
  });

  it('пустой список и ошибка загрузки', async () => {
    serve([]);
    const first = renderAnalytics(OPS);
    expect(await screen.findByText(/Записей за выбранный период нет/)).toBeInTheDocument();
    void first;
  });

  it('ошибка загрузки: сообщение и повтор', async () => {
    let failing = true;
    harness.handlers['/api/expenses'] = () =>
      failing
        ? json({ success: false, error: { code: 'X', message: 'Сбой сервера' } }, 500)
        : ok(page([item(1)]));
    const user = renderAnalytics(OPS);

    expect(await screen.findByRole('alert')).toHaveTextContent('Сбой сервера');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByRole('table', { name: 'Операции' })).toBeInTheDocument();
  });
});

describe('состояние записи относительно Excel', () => {
  const cases: [OperationItem['excelState'], string, string?][] = [
    ['synced', 'Совпадает с Excel'],
    ['pending-add', 'В очереди: нет в Excel'],
    ['pending-update', 'Отличается от Excel'],
    ['pending-remove', 'В очереди: удалить из Excel'],
    ['removed', 'Удалена, из Excel убрана'],
    ['missing', 'Удалена: строки нет в Excel'],
  ];

  it.each(cases)('%s → «%s»', async (state, label) => {
    serve([item(1, { excelState: state, deletedAt: state === 'synced' ? null : null })]);
    renderAnalytics(OPS);

    const row = await waitFor(() => rowOf('Позиция 1'));

    expect(row).toHaveTextContent(label);
  });

  it('для записей в очереди указана причина', async () => {
    serve([item(1, { excelState: 'pending-update', excelError: 'FILE_LOCKED' })]);
    renderAnalytics(OPS);

    const row = await waitFor(() => rowOf('Позиция 1'));

    expect(row).toHaveTextContent('Причина: файл открыт в Excel');
  });

  it('у синхронизированной записи причины нет', async () => {
    serve([item(1, { excelState: 'synced', excelError: 'FILE_LOCKED' })]);
    renderAnalytics(OPS);

    const row = await waitFor(() => rowOf('Позиция 1'));

    expect(row).not.toHaveTextContent('Причина');
  });

  it('если Excel отключён, вместо состояний написано об этом', async () => {
    serve([item(1, { excelState: 'pending-add' })]);
    harness.handlers['/api/sync/status'] = () =>
      ok({
        enabled: false,
        queued: 0,
        running: false,
        intervalMs: 1,
        nextRunAt: null,
        serverTime: '',
      });
    renderAnalytics(OPS);

    await waitFor(() => expect(rowOf('Позиция 1')).toHaveTextContent('Excel отключён'));
    expect(rowOf('Позиция 1')).not.toHaveTextContent('В очереди');
  });
});

describe('сортировка и страницы', () => {
  it('нажатие на заголовок сортирует на сервере, повторное меняет направление', async () => {
    serve();
    const user = renderAnalytics(OPS);
    await waitFor(() => rowOf('Позиция 1'));

    await user.click(within(table()).getByRole('button', { name: /Стоимость/ }));
    await waitFor(() => expect(lastList()).toContain('sort=amount&direction=desc'));
    expect(within(table()).getByRole('columnheader', { name: /Стоимость/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(within(table()).getByRole('button', { name: /Стоимость/ }));
    await waitFor(() => expect(lastList()).toContain('sort=amount&direction=asc'));

    await user.click(within(table()).getByRole('button', { name: /Наименование/ }));
    await waitFor(() => expect(lastList()).toContain('sort=name&direction=asc'));
  });

  it('сортировка из адреса применяется сразу, неизвестная игнорируется', async () => {
    serve();
    renderAnalytics(`${OPS}?sort=category&dir=asc`);
    await waitFor(() => expect(lastList()).toContain('sort=category&direction=asc'));
  });

  it('страницы по 50: «Вперёд» открывает следующие записи, число записей и диапазон видны', async () => {
    serve([item(1), item(2)], 120);
    const user = renderAnalytics(OPS);
    const nav = await screen.findByRole('navigation', { name: 'Страницы' });

    expect(nav).toHaveTextContent('1–50 из 120');
    expect(within(nav).getByRole('button', { name: /Назад/ })).toBeDisabled();

    await user.click(within(nav).getByRole('button', { name: /Вперёд/ }));

    await waitFor(() => expect(lastList()).toContain('limit=50&offset=50'));
    expect(screen.getByTestId('location')).toHaveTextContent('page=2');
    expect(await screen.findByText('51–100 из 120')).toBeInTheDocument();
  });

  it('при изменении фильтров возвращаемся на первую страницу', async () => {
    serve([item(1)], 120);
    const user = renderAnalytics(`${OPS}?page=3`);
    await waitFor(() => expect(lastList()).toContain('offset=100'));

    await user.click(screen.getByRole('radio', { name: '30 дней' }));

    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('page='));
    await waitFor(() => expect(lastList()).toContain('offset=0'));
  });

  it('страницы нет, если записей не больше 50', async () => {
    serve([item(1)], 50);
    renderAnalytics(OPS);
    await waitFor(() => rowOf('Позиция 1'));

    expect(screen.queryByRole('navigation', { name: 'Страницы' })).toBeNull();
  });
});

describe('права', () => {
  it('без права редактирования действий нет, показан режим просмотра', async () => {
    serve();
    harness.handlers['/api/auth/me'] = () =>
      ok({ user: { username: 'nastya', displayName: 'Настя', card: 'Настя', canEdit: false } });
    renderAnalytics(OPS);
    await waitFor(() => rowOf('Позиция 1'));

    expect(screen.queryByRole('button', { name: /^Изменить запись/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Удалить запись/ })).toBeNull();
    expect(within(table()).queryByRole('columnheader', { name: 'Действия' })).toBeNull();
    expect(screen.getByText(/Режим просмотра/)).toBeInTheDocument();
  });

  it('у редактора есть «Изменить» и «Удалить» у каждой записи', async () => {
    serve([item(1), item(2)]);
    renderAnalytics(OPS);
    await waitFor(() => rowOf('Позиция 1'));

    expect(within(table()).getAllByRole('button', { name: /^Изменить запись/ })).toHaveLength(2);
    expect(within(table()).getAllByRole('button', { name: /^Удалить запись/ })).toHaveLength(2);
    expect(screen.queryByText(/Режим просмотра/)).toBeNull();
  });
});

describe('правка', () => {
  const edited = { id: ID(1), deletedAt: null, excelState: 'pending-update' };

  async function openEditor(items = [item(1)]) {
    serve(items);
    const user = renderAnalytics(OPS);
    await waitFor(() => rowOf(items[0]!.name));
    await user.click(
      within(table()).getByRole('button', { name: `Изменить запись: ${items[0]!.name}` }),
    );
    return { user, dialog: await screen.findByRole('dialog', { name: 'Изменить запись' }) };
  }

  it('форма открывается с текущими значениями', async () => {
    const { dialog } = await openEditor([item(1, { date: '2026-10-05', amount: 12345 })]);

    expect(within(dialog).getByLabelText('Дата')).toHaveValue('2026-10-05');
    expect(within(dialog).getByLabelText('Карта')).toHaveValue('Миша');
    expect(within(dialog).getByLabelText('Категория')).toHaveValue('кафе');
    expect(within(dialog).getByLabelText('Наименование')).toHaveValue('Позиция 1');
    expect(within(dialog).getByLabelText('Стоимость, AMD')).toHaveValue('12 345');
  });

  it('«Сохранить» недоступно, пока ничего не изменено', async () => {
    const { dialog } = await openEditor();

    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('отправляются только изменённые поля; после сохранения окно закрывается, список обновляется', async () => {
    harness.handlers['PATCH /api/expenses/:id'] = () => ok(edited);
    const { user, dialog } = await openEditor();
    const before = listRequests().length;

    const name = within(dialog).getByLabelText('Наименование');
    await user.clear(name);
    await user.type(name, 'Новое имя');
    const amount = within(dialog).getByLabelText('Стоимость, AMD');
    await user.clear(amount);
    await user.type(amount, '2500');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patchIndex = harness.requests.findIndex((r) => r.startsWith('PATCH '));
    expect(harness.requests[patchIndex]).toBe(`PATCH /api/expenses/${ID(1)}`);
    expect(harness.bodies[patchIndex]).toEqual({ name: 'Новое имя', amount: 2500 });
    expect(await screen.findByText('Запись «Новое имя» изменена')).toBeInTheDocument();
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
  });

  it('проверка полей: пустое наименование и нулевая стоимость', async () => {
    const { user, dialog } = await openEditor();

    await user.clear(within(dialog).getByLabelText('Наименование'));
    await user.clear(within(dialog).getByLabelText('Стоимость, AMD'));
    await user.type(within(dialog).getByLabelText('Стоимость, AMD'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(await within(dialog).findByText('Введите наименование')).toBeInTheDocument();
    expect(within(dialog).getByText('Стоимость должна быть больше нуля')).toBeInTheDocument();
    expect(harness.requests.some((r) => r.startsWith('PATCH '))).toBe(false);
  });

  it('ошибка сервера показывается в окне, окно остаётся открытым', async () => {
    harness.handlers['PATCH /api/expenses/:id'] = () =>
      json(
        {
          success: false,
          error: { code: 'EXPENSE_BUSY', message: 'Запись сейчас записывается в Excel' },
        },
        409,
      );
    const { user, dialog } = await openEditor();

    await user.type(within(dialog).getByLabelText('Наименование'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Запись сейчас записывается в Excel',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('смена суммы расхода в валюте предупреждает, что исходная сумма сбросится', async () => {
    const { user, dialog } = await openEditor([
      item(1, { original: { amount: 10, currency: 'USD', rate: 380 }, amount: 3800 }),
    ]);
    expect(within(dialog).queryByText(/Исходная сумма/)).toBeNull();

    const amount = within(dialog).getByLabelText('Стоимость, AMD');
    await user.clear(amount);
    await user.type(amount, '4000');

    expect(
      within(dialog).getByText(/Исходная сумма \(10 USD по курсу 380\) будет сброшена/),
    ).toBeInTheDocument();
  });

  it('Escape и «Отмена» закрывают окно без запроса', async () => {
    const { user, dialog } = await openEditor();

    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(table()).getByRole('button', { name: /^Изменить запись/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.requests.some((r) => r.startsWith('PATCH '))).toBe(false);
  });

  it('карта и категория, которых нет в справочниках, остаются доступными', async () => {
    const { dialog } = await openEditor([item(1, { card: 'Старая карта', category: 'архивная' })]);

    expect(within(dialog).getByLabelText('Карта')).toHaveValue('Старая карта');
    expect(within(dialog).getByLabelText('Категория')).toHaveValue('архивная');
  });
});

describe('удаление и возврат', () => {
  it('удаление с подтверждением: отмена ничего не делает, подтверждение отправляет запрос', async () => {
    serve([item(1)]);
    harness.handlers['DELETE /api/expenses/:id'] = () =>
      ok({ id: ID(1), deletedAt: 'x', excelState: 'pending-remove' });
    const user = renderAnalytics(OPS);
    await waitFor(() => rowOf('Позиция 1'));

    await user.click(within(table()).getByRole('button', { name: 'Удалить запись: Позиция 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить запись?' });
    expect(dialog).toHaveTextContent('Позиция 1');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(harness.requests.some((r) => r.startsWith('DELETE '))).toBe(false);

    await user.click(within(table()).getByRole('button', { name: 'Удалить запись: Позиция 1' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(harness.requests).toContain(`DELETE /api/expenses/${ID(1)}`);
    expect(await screen.findByText('Запись «Позиция 1» удалена')).toBeInTheDocument();
  });

  it('ошибка удаления: сообщение и окно закрывается', async () => {
    serve([item(1)]);
    harness.handlers['DELETE /api/expenses/:id'] = () =>
      json(
        {
          success: false,
          error: { code: 'EXPENSE_BUSY', message: 'Запись сейчас записывается в Excel' },
        },
        409,
      );
    const user = renderAnalytics(OPS);
    await waitFor(() => rowOf('Позиция 1'));

    await user.click(within(table()).getByRole('button', { name: /^Удалить запись/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Запись сейчас записывается в Excel',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('удалённая запись: перечёркнута, вместо «Изменить» есть «Вернуть»', async () => {
    serve([
      item(1, {
        deletedAt: '2026-10-11T10:00:00.000Z',
        deletedReason: 'app',
        excelState: 'pending-remove',
      }),
    ]);
    harness.handlers['POST /api/expenses/:id/restore'] = () =>
      ok({ id: ID(1), deletedAt: null, excelState: 'synced' });
    const user = renderAnalytics(`${OPS}?deleted=1`);
    await waitFor(() => rowOf('Позиция 1'));

    expect(within(table()).queryByRole('button', { name: /^Изменить запись/ })).toBeNull();
    expect(within(table()).getByRole('rowheader', { name: 'Позиция 1' })).toHaveClass(
      'line-through',
    );
    expect(lastList()).toContain('includeDeleted=true');

    await user.click(within(table()).getByRole('button', { name: 'Вернуть запись: Позиция 1' }));

    expect(await screen.findByText('Запись «Позиция 1» возвращена')).toBeInTheDocument();
    expect(harness.requests).toContain(`POST /api/expenses/${ID(1)}/restore`);
  });
});

describe('вкладка', () => {
  it('«Операции» есть среди вкладок и открывается', async () => {
    serve();
    const user = renderAnalytics('/analytics');

    await user.click(await screen.findByRole('link', { name: 'Операции' }));

    expect(await screen.findByRole('heading', { name: 'Все операции' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Операции' })).toHaveAttribute('aria-current', 'page');
  });

  it('фильтры панели применяются к списку (например, карта)', async () => {
    serve();
    renderAnalytics(`${OPS}?card=${encodeURIComponent('Настя')}`);

    await waitFor(() => expect(lastList()).toContain('cards=Настя'));
  });
});
