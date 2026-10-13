import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OperationItem } from '../src/features/analytics/api/operations.api.ts';
import type { ExpenseItem } from '../src/features/items/api/items.api.ts';
import {
  harness,
  json,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';
import { chooseAction } from './helpers/operation-menu.ts';

setupAnalyticsHarness();

const ID = '00000000-0000-4000-8000-000000000001';
const OPS = '/analytics/operations';

const operation = (overrides: Partial<OperationItem> = {}): OperationItem => ({
  id: ID,
  date: '2026-10-10',
  card: 'Миша',
  category: 'кафе',
  name: 'Супермаркет',
  amount: 12460.5,
  currency: 'AMD',
  original: null,
  editable: true,
  editableUntil: null,
  createdBy: 'misha',
  source: 'app',
  excelState: 'synced',
  excelError: null,
  deletedAt: null,
  deletedReason: null,
  updatedBy: null,
  ...overrides,
});

const lines: ExpenseItem[] = [
  { id: 'i1', position: 1, name: 'Хлеб', price: 120.5, quantity: 1, source: 'ai' },
  { id: 'i2', position: 2, name: 'Сыр', price: 12220, quantity: 0.35, source: 'manual' },
];

let itemsOnServer: ExpenseItem[];

function serve(op: OperationItem, available = false) {
  itemsOnServer = lines;
  harness.handlers['/api/expenses'] = () => ok({ items: [op], total: 1, totalAmount: op.amount });
  harness.handlers['/api/ai/status'] = () =>
    ok({ installationReady: available, groupEnabled: available, available });
  harness.handlers['/api/expenses/:id/items'] = () => ok(itemsOnServer);
  harness.handlers['PUT /api/expenses/:id/items'] = () => ok(itemsOnServer);
}

const table = () => screen.getByRole('table', { name: 'Операции' });

async function openEditor(op: OperationItem, available = false) {
  serve(op, available);
  const user = renderAnalytics(OPS);
  await waitFor(() => within(table()).getByText(op.name));
  await chooseAction(user, table(), 'Изменить');
  const dialog = await screen.findByRole('dialog', { name: 'Изменить запись' });
  return { user, dialog };
}

const AI = 'Сгенерировано с помощью AI';

describe('позиции в списке операций', () => {
  it('у записи с позициями приглушённый счётчик «2 позиции»; без позиций счётчика нет', async () => {
    serve(operation({ itemsCount: 2 }));
    renderAnalytics(OPS);

    await waitFor(() => within(table()).getByText('Супермаркет'));
    expect(within(table()).getByRole('button', { name: '2 позиции' })).toBeInTheDocument();
  });

  it('нет позиций: нет и счётчика', async () => {
    serve(operation({ itemsCount: 0 }));
    renderAnalytics(OPS);
    await waitFor(() => within(table()).getByText('Супермаркет'));

    expect(screen.queryByRole('button', { name: /позици/ })).toBeNull();
  });

  it('клик раскрывает список; у сгенерированной позиции пометка AI, у ручной нет', async () => {
    serve(operation({ itemsCount: 2, aiItemsCount: 1 }));
    const user = renderAnalytics(OPS);

    await waitFor(() => within(table()).getByText('Супермаркет'));
    await user.click(within(table()).getByRole('button', { name: '2 позиции' }));

    const list = await screen.findByRole('list', { name: 'Позиции' });
    const [bread, cheese] = within(list).getAllByRole('listitem');
    expect(within(bread!).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(within(cheese!).queryByRole('img', { name: AI })).toBeNull();
    expect(cheese).toHaveTextContent('Сыр');
    expect(cheese).toHaveTextContent('0,35');
  });

  it('позиции запрашиваются только по клику', async () => {
    serve(operation({ itemsCount: 2 }));
    const user = renderAnalytics(OPS);
    await waitFor(() => within(table()).getByText('Супермаркет'));
    expect(harness.requests.some((r) => r.endsWith('/items'))).toBe(false);

    await user.click(within(table()).getByRole('button', { name: '2 позиции' }));

    await waitFor(() => expect(harness.requests.some((r) => r.endsWith('/items'))).toBe(true));
  });

  it('название, сгенерированное ИИ, помечено искрой и в списке', async () => {
    serve(operation({ nameSource: 'ai' }));
    renderAnalytics(OPS);

    await waitFor(() => within(table()).getByText('Супермаркет'));

    expect(within(table()).getByRole('img', { name: AI })).toBeInTheDocument();
  });
});

describe('карточка записи: пометки AI', () => {
  it('у названия и даты с источником ai есть пометка; у обычных нет', async () => {
    const { dialog } = await openEditor(operation({ nameSource: 'ai', dateSource: 'ai' }));

    expect(within(dialog).getAllByRole('img', { name: AI }).length).toBeGreaterThanOrEqual(2);
    const nameLabel = within(dialog).getByText('Наименование', { selector: 'label' });
    expect(within(nameLabel).getByRole('img', { name: AI })).toBeInTheDocument();
  });

  it('manual: пометок у полей нет', async () => {
    const { dialog } = await openEditor(operation({ nameSource: 'manual', dateSource: 'default' }));

    const nameLabel = within(dialog).getByText('Наименование', { selector: 'label' });
    expect(within(nameLabel).queryByRole('img', { name: AI })).toBeNull();
  });

  it('правка названия человеком снимает пометку с названия', async () => {
    const { user, dialog } = await openEditor(operation({ nameSource: 'ai' }));
    const nameLabel = () => within(dialog).getByText('Наименование', { selector: 'label' });
    expect(within(nameLabel()).getByRole('img', { name: AI })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Наименование'), '!');

    expect(within(nameLabel()).queryByRole('img', { name: AI })).toBeNull();
  });
});

describe('карточка записи: раздел «Позиции»', () => {
  it('показывает позиции; пометка AI только у сгенерированной', async () => {
    const { dialog } = await openEditor(operation());

    const section = await within(dialog).findByRole('region', { name: 'Позиции' });
    expect(within(section).getByLabelText('Название позиции 1')).toHaveValue('Хлеб');
    expect(within(section).getByLabelText('Цена позиции 1')).toHaveValue('120,5');
    expect(within(section).getByLabelText('Количество позиции 2')).toHaveValue('0,35');
    expect(within(section).getAllByRole('img', { name: AI })).toHaveLength(1);
  });

  it('правка человеком снимает пометку именно с этой позиции', async () => {
    const { user, dialog } = await openEditor(operation());
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    await user.type(within(section).getByLabelText('Название позиции 1'), 'ы');

    expect(within(section).queryByRole('img', { name: AI })).toBeNull();
  });

  it('сохранение: PUT со всем списком и id существующих позиций', async () => {
    const { user, dialog } = await openEditor(operation());
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });
    expect(within(section).queryByRole('button', { name: 'Сохранить позиции' })).toBeNull();

    await user.clear(within(section).getByLabelText('Цена позиции 1'));
    await user.type(within(section).getByLabelText('Цена позиции 1'), '130,25');
    await user.click(within(section).getByRole('button', { name: 'Сохранить позиции' }));

    await waitFor(() => expect(harness.requests).toContain(`PUT /api/expenses/${ID}/items`));
    const index = harness.requests.indexOf(`PUT /api/expenses/${ID}/items`);
    expect(harness.bodies[index]).toEqual({
      items: [
        { id: 'i1', name: 'Хлеб', price: 130.25 },
        { id: 'i2', name: 'Сыр', price: 12220, quantity: 0.35 },
      ],
    });
  });

  it('ошибка заполнения показывается и запрос не уходит', async () => {
    const { user, dialog } = await openEditor(operation());
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    await user.clear(within(section).getByLabelText('Название позиции 2'));
    await user.click(within(section).getByRole('button', { name: 'Сохранить позиции' }));

    expect(await within(section).findByText('Позиция 2: укажите название')).toBeInTheDocument();
    expect(harness.requests).not.toContain(`PUT /api/expenses/${ID}/items`);
  });

  it('расхождение: одна приглушённая строка с подсказкой, без красного', async () => {
    const { dialog } = await openEditor(operation({ amount: 12460.5 }));
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    const note = within(section).getByText('Сумма позиций 12 340,50, на 120 меньше суммы операции');
    expect(note).toHaveAttribute('title', expect.stringContaining('скидки, чаевые и округление'));
    expect(note.className).toContain('text-zinc-500');
    expect(note.className).not.toContain('red');
  });

  it('разница меньше единицы не показывается', async () => {
    const { dialog } = await openEditor(operation({ amount: 12340.9 }));
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    expect(within(section).queryByText(/Сумма позиций/)).toBeNull();
  });

  it('расхождение пересчитывается по мере правки цен', async () => {
    const { user, dialog } = await openEditor(operation({ amount: 12340.5 }));
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });
    expect(within(section).queryByText(/Сумма позиций/)).toBeNull();

    await user.clear(within(section).getByLabelText('Цена позиции 2'));
    await user.type(within(section).getByLabelText('Цена позиции 2'), '12000');

    expect(
      within(section).getByText('Сумма позиций 12 120,50, на 220 меньше суммы операции'),
    ).toBeInTheDocument();
  });

  it('без ИИ нет «Разобрать чек заново», но «Принять сгенерированное» есть, пока есть что принять', async () => {
    const { dialog } = await openEditor(operation({ hasReceipt: true }));
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    expect(within(section).queryByRole('button', { name: 'Разобрать чек заново' })).toBeNull();
    expect(
      within(section).getByRole('button', { name: 'Принять сгенерированное' }),
    ).toBeInTheDocument();
  });

  it('«Принять сгенерированное» не показывается, если ИИ ничего не генерировал', async () => {
    serve(operation());
    itemsOnServer = lines.map((line) => ({ ...line, source: 'manual' }));
    const user = renderAnalytics(OPS);
    await waitFor(() => within(table()).getByText('Супермаркет'));
    await chooseAction(user, table(), 'Изменить');
    const dialog = await screen.findByRole('dialog', { name: 'Изменить запись' });
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    expect(within(section).queryByRole('button', { name: 'Принять сгенерированное' })).toBeNull();
  });

  it('«Принять сгенерированное»: DELETE /ai, сообщение, окно закрывается', async () => {
    harness.handlers['DELETE /api/expenses/:id/ai'] = () => ok({});
    const { user, dialog } = await openEditor(operation({ nameSource: 'ai' }));
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    await user.click(within(section).getByRole('button', { name: 'Принять сгенерированное' }));

    await waitFor(() => expect(harness.requests).toContain(`DELETE /api/expenses/${ID}/ai`));
    expect(await screen.findByText('Сгенерированное принято')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Изменить запись' })).toBeNull();
  });

  it('«Разобрать чек заново»: только с ИИ и фото чека; POST /receipt/parse', async () => {
    harness.handlers['POST /api/expenses/:id/receipt/parse'] = () =>
      ok({
        nameFilled: true,
        dateFilled: false,
        itemsFilled: true,
        itemsOffered: false,
        dropped: 0,
        total: null,
        currency: null,
      });
    const { user, dialog } = await openEditor(operation({ hasReceipt: true }), true);
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    await user.click(within(section).getByRole('button', { name: 'Разобрать чек заново' }));

    await waitFor(() =>
      expect(harness.requests).toContain(`POST /api/expenses/${ID}/receipt/parse`),
    );
    const index = harness.requests.indexOf(`POST /api/expenses/${ID}/receipt/parse`);
    expect(harness.bodies[index]).toEqual({ replaceItems: false });
    expect(await screen.findByText('Чек разобран ИИ')).toBeInTheDocument();
  });

  it('с ИИ, но без фото чека кнопки разбора нет', async () => {
    const { dialog } = await openEditor(operation({ hasReceipt: false }), true);
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    expect(within(section).queryByRole('button', { name: 'Разобрать чек заново' })).toBeNull();
  });

  it('если позиции из чека предложены, «Заменить позиции из чека» шлёт replaceItems: true', async () => {
    let calls = 0;
    harness.handlers['POST /api/expenses/:id/receipt/parse'] = () =>
      ok({
        nameFilled: false,
        dateFilled: false,
        itemsFilled: false,
        itemsOffered: ++calls === 1,
        dropped: 0,
        total: null,
        currency: null,
      });
    const { user, dialog } = await openEditor(operation({ hasReceipt: true }), true);
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });
    await user.click(within(section).getByRole('button', { name: 'Разобрать чек заново' }));

    await user.click(
      await within(section).findByRole('button', { name: 'Заменить позиции из чека' }),
    );

    await waitFor(() => {
      const bodies = harness.requests
        .map((request, index) => [request, harness.bodies[index]] as const)
        .filter(([request]) => request.endsWith('/receipt/parse'));
      expect(bodies.map(([, body]) => body)).toEqual([
        { replaceItems: false },
        { replaceItems: true },
      ]);
    });
  });

  it('ошибка разбора показывается мягко, окно остаётся открытым', async () => {
    harness.handlers['POST /api/expenses/:id/receipt/parse'] = () =>
      json(
        {
          success: false,
          error: { code: 'AI_LIMIT_REACHED', message: 'Лимит разборов на сегодня исчерпан' },
        },
        429,
      );
    const { user, dialog } = await openEditor(operation({ hasReceipt: true }), true);
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    await user.click(within(section).getByRole('button', { name: 'Разобрать чек заново' }));

    expect(
      await within(section).findByText(
        'Не удалось разобрать чек, заполните вручную. Лимит разборов на сегодня исчерпан',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Изменить запись' })).toBeInTheDocument();
  });
});

describe('раскрытые позиции в списке', () => {
  async function open(op = operation({ itemsCount: 2, aiItemsCount: 1 })) {
    serve(op);
    const user = renderAnalytics(OPS);
    await waitFor(() => within(table()).getByText('Супермаркет'));
    const toggle = within(table()).getByRole('button', { name: '2 позиции' });
    await user.click(toggle);
    return { user, toggle, list: await screen.findByRole('list', { name: 'Позиции' }) };
  }

  it('кнопка с шевроном: aria-expanded меняется, область нажатия не ниже 44px', async () => {
    const { user, toggle } = await open();

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.className).toContain('min-h-11');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Позиции' })).toBeNull();
  });

  it('список — отдельный блок на всю ширину строки таблицы, а не в узкой колонке названия', async () => {
    const { list } = await open();

    const cell = list.closest('td')!;
    expect(cell).toHaveAttribute('colspan');
    expect(list.closest<HTMLElement>('.rounded-xl')!.className).toContain('bg-zinc-50');
    expect(list.closest<HTMLElement>('.rounded-xl')!.className).toContain('dark:bg-zinc-800/40');
  });

  it('строка: название слева, количество под ним мелко, цена справа с двумя знаками у дробной', async () => {
    const { list } = await open();

    const [bread, cheese] = within(list).getAllByRole('listitem');
    expect(bread).toHaveTextContent('Хлеб');
    expect(bread).toHaveTextContent('120,50');
    expect(bread).not.toHaveTextContent('×');
    expect(cheese).toHaveTextContent('0,35 × 34 914,29');
    expect(cheese).toHaveTextContent('12 220');
    expect(within(cheese!).getByText('12 220').className).toContain('tabular-nums');
  });

  it('внизу сумма позиций и приглушённое расхождение с суммой операции', async () => {
    const { list } = await open(operation({ itemsCount: 2, amount: 12460.5 }));

    const footer = list.closest<HTMLElement>('.rounded-xl')!;
    expect(within(footer).getByText('Сумма позиций 12 340,50 AMD')).toBeInTheDocument();
    const note = within(footer).getByText('Сумма позиций 12 340,50, на 120 меньше суммы операции');
    expect(note.className).not.toContain('red');
  });

  it('расхождение меньше единицы не показывается, сумма позиций остаётся', async () => {
    const { list } = await open(operation({ itemsCount: 2, amount: 12340.9 }));

    expect(
      within(list.closest<HTMLElement>('.rounded-xl')!).getByText('Сумма позиций 12 340,50 AMD'),
    ).toBeInTheDocument();
    expect(
      within(list.closest<HTMLElement>('.rounded-xl')!).queryByText(/меньше суммы|больше суммы/),
    ).toBeNull();
  });
});

describe('«Разобрать чек заново» и категории ИИ', () => {
  it('категория выключена для ИИ: кнопки нет', async () => {
    harness.handlers['/api/receipts/settings'] = () =>
      ok({ enabled: true, categories: ['кафе'], aiCategories: ['продукты'] });
    const { dialog } = await openEditor(operation({ hasReceipt: true }), true);
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    expect(within(section).queryByRole('button', { name: 'Разобрать чек заново' })).toBeNull();
  });

  it('категория разрешена для ИИ: кнопка есть', async () => {
    harness.handlers['/api/receipts/settings'] = () =>
      ok({ enabled: true, categories: ['кафе'], aiCategories: ['кафе'] });
    const { dialog } = await openEditor(operation({ hasReceipt: true }), true);
    const section = await within(dialog).findByRole('region', { name: 'Позиции' });

    await waitFor(() =>
      expect(
        within(section).getByRole('button', { name: 'Разобрать чек заново' }),
      ).toBeInTheDocument(),
    );
  });
});

describe('раскрытые позиции: вид как в форме', () => {
  async function open(op: OperationItem) {
    serve(op);
    const user = renderAnalytics(OPS);
    await waitFor(() => within(table()).getByText('Супермаркет'));
    await user.click(within(table()).getByRole('button', { name: '2 позиции' }));
    return screen.findByRole('list', { name: 'Позиции' });
  }

  it('«кол-во × цена за единицу» под названием, если количество не 1', async () => {
    const list = await open(operation({ itemsCount: 2 }));

    const [bread, cheese] = within(list).getAllByRole('listitem');
    expect(bread).not.toHaveTextContent('×');
    expect(cheese).toHaveTextContent('0,35 × 34 914,29');
  });

  it('на десктопе блок прокручивается внутри (до 320px), на телефоне нет', async () => {
    const list = await open(operation({ itemsCount: 2 }));

    expect(list.parentElement!.className).toContain('md:max-h-80');
    expect(list.parentElement!.className).toContain('md:overflow-y-auto');
    expect(list.parentElement!.className).not.toMatch(/(^|\s)overflow-y-auto/);
  });

  it('внизу жирно «Сумма позиций N AMD»', async () => {
    const list = await open(operation({ itemsCount: 2 }));

    const total = within(list.closest<HTMLElement>('.rounded-xl')!).getByText(
      'Сумма позиций 12 340,50 AMD',
    );
    expect(total.className).toContain('font-semibold');
  });
});
