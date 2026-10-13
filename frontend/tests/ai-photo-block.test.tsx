import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  allowPhotos,
  enableAi,
  failure,
  ok,
  pickPhoto,
  renderApp,
  server,
  setupOfflineHarness,
  stubImaging,
  type Person,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

async function ready(confirmed = true) {
  enableAi();
  allowPhotos();
  if (confirmed) server.preferences = { 'ai.noticeSeen': true };
  return renderApp();
}

const answer =
  (patch: Record<string, unknown> = {}) =>
  () =>
    ok({
      parseId: 'p1',
      name: 'Кофейня',
      date: null,
      items: [],
      total: null,
      currency: null,
      dropped: 0,
      ...patch,
    });

describe('блок «Фото чека»', () => {
  it('подпись, миниатюра с крестиком и «Заменить фото» под ней', async () => {
    const { person } = await ready();

    await pickPhoto(person);

    expect(screen.getByText('Фото чека', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByAltText('Фото чека')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Убрать фото' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Заменить фото' })).toBeInTheDocument();
  });

  it('разбор идёт: нейтральная карточка «Распознаём чек…», форма не заблокирована', async () => {
    server.parsePhoto = () => new Promise<Response>(() => undefined);
    const { person } = await ready();

    await pickPhoto(person);

    const card = await screen.findByText('Распознаём чек…');
    expect(card.closest('[role="status"]')!.className).toContain('bg-zinc-50');
    expect(screen.getByLabelText('Стоимость')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeEnabled();
  });

  it('успех: галочка, «Чек распознан», «Найдено 1 товар · итог с чека»', async () => {
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText('Чек распознан')).toBeInTheDocument();
    expect(screen.getByText('Найдено 1 товар · 1 500,50 AMD')).toBeInTheDocument();
  });

  it('итога на чеке нет: показывается сумма позиций', async () => {
    server.parsePhoto = answer({
      items: [
        { name: 'Сыр', price: 1000.1, quantity: 1 },
        { name: 'Хлеб', price: 1095.56, quantity: 1 },
      ],
    });
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText('Найдено 2 товара · 2 095,66 AMD')).toBeInTheDocument();
  });

  it('товаров нет: «Товары не найдены»', async () => {
    server.parsePhoto = answer();
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText('Товары не найдены')).toBeInTheDocument();
  });

  it('ошибка: мягкая жёлтая карточка «Не удалось распознать чек» с причиной и «Повторить»', async () => {
    server.parsePhoto = () => failure(503, 'ИИ временно недоступен', 'AI_UNAVAILABLE');
    const { person } = await ready();

    await pickPhoto(person);

    const title = await screen.findByText('Не удалось распознать чек');
    expect(title.parentElement!.className).toContain('bg-amber-50');
    expect(within(title.parentElement!).getByText('ИИ временно недоступен')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('ИИ недоступен: только миниатюра и «Заменить фото», карточки нет', async () => {
    allowPhotos();
    const { person } = await renderApp();

    await pickPhoto(person);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByRole('button', { name: 'Заменить фото' })).toBeInTheDocument();
    expect(screen.queryByText(/Распознаём|Чек распознан|Не удалось распознать/)).toBeNull();
  });

  it('категория без ИИ: тоже без карточки', async () => {
    enableAi();
    server.receiptSettings = { enabled: true, categories: ['кафе'], aiCategories: [] };
    server.preferences = { 'ai.noticeSeen': true };
    stubImaging();
    const { person } = await renderApp();

    await pickPhoto(person);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByRole('button', { name: 'Заменить фото' })).toBeInTheDocument();
    expect(screen.queryByText(/Распознаём|Чек распознан/)).toBeNull();
  });

  it('«Заменить фото» открывает выбор файла и запускает новый разбор', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByText('Чек распознан');

    await person.upload(
      screen.getByLabelText('Выбрать фото чека'),
      new File(['img2'], 'second.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => expect(server.photoParses()).toHaveLength(2));
  });
});

describe('просмотр выбранного чека', () => {
  it('клик по миниатюре открывает просмотрщик с локальным фото; закрытие работает', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    const thumb = screen.getByRole('button', { name: 'Посмотреть чек' });
    expect(thumb.className).toContain('cursor-pointer');
    expect(thumb.className).toContain('min-h-11');

    await person.click(thumb);

    const viewer = await screen.findByRole('dialog', { name: 'Фото чека' });
    expect(within(viewer).getByRole('img', { name: 'Фото чека' })).toHaveAttribute(
      'src',
      'blob:photo',
    );
    await person.click(within(viewer).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Фото чека' })).toBeNull();
  });

  it('крестик убирает фото и не открывает просмотр', async () => {
    const { person } = await ready();
    await pickPhoto(person);

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));

    expect(screen.queryByRole('dialog', { name: 'Фото чека' })).toBeNull();
    expect(screen.queryByAltText('Фото чека')).toBeNull();
  });

  it('работает и в категории без ИИ, и при ошибке разбора', async () => {
    server.parsePhoto = () => failure(503, 'x', 'AI_UNAVAILABLE');
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByText('Не удалось распознать чек');

    await person.click(screen.getByRole('button', { name: 'Посмотреть чек' }));

    expect(await screen.findByRole('dialog', { name: 'Фото чека' })).toBeInTheDocument();
  });
});

async function parsed(person: Person) {
  await pickPhoto(person);
  await screen.findByDisplayValue('Кофейня');
}

describe('позиции чека на «Добавить»: карточка и виды', () => {
  const rows = {
    items: [
      { name: 'Сыр', price: 465.66, quantity: 0.234 },
      { name: 'Хлеб', price: 1630, quantity: 1 },
    ],
  };

  it('после разбора — свёрнутая карточка «Позиции чека (2)» с суммой и шевроном; разворачивается', async () => {
    server.parsePhoto = answer(rows);
    const { person } = await ready();
    await parsed(person);

    const card = screen.getByRole('button', { name: /^Позиции чека \(2\)/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(card).toHaveTextContent('2 095,66 AMD');
    expect(screen.queryByRole('radio', { name: 'Простой вид' })).toBeNull();

    await person.click(card);

    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: 'Простой вид' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Редактирование' })).not.toBeChecked();
  });

  it('простой вид: только чтение, «кол-во × цена за единицу» у позиции с количеством не 1', async () => {
    server.parsePhoto = answer(rows);
    const { person } = await ready();
    await parsed(person);
    await person.click(screen.getByRole('button', { name: /^Позиции чека/ }));

    const [cheese, bread] = within(screen.getByRole('list', { name: 'Позиции' })).getAllByRole(
      'listitem',
    );
    expect(cheese).toHaveTextContent('Сыр');
    expect(cheese).toHaveTextContent('0,234 × 1 990');
    expect(cheese).toHaveTextContent('465,66');
    expect(bread).not.toHaveTextContent('×');
    expect(screen.queryByLabelText('Название позиции 1')).toBeNull();
  });

  it('«Редактирование» показывает поля и «+ Добавить позицию»; обратно — простой вид', async () => {
    server.parsePhoto = answer(rows);
    const { person } = await ready();
    await parsed(person);
    await person.click(screen.getByRole('button', { name: /^Позиции чека/ }));

    await person.click(screen.getByRole('radio', { name: 'Редактирование' }));
    expect(screen.getByLabelText('Название позиции 1')).toHaveValue('Сыр');
    await person.click(screen.getByRole('button', { name: 'Добавить позицию' }));
    expect(screen.getByLabelText('Название позиции 3')).toBeInTheDocument();
    await person.click(screen.getByRole('radio', { name: 'Простой вид' }));

    expect(screen.queryByLabelText('Название позиции 1')).toBeNull();
  });

  it('ссылка «+ Позиции чека» сразу открывает редактирование', async () => {
    const { person } = await renderApp();

    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));

    expect(screen.getByRole('radio', { name: 'Редактирование' })).toBeChecked();
    expect(screen.getByLabelText('Название позиции 1')).toBeInTheDocument();
  });

  it('внизу «Сумма позиций N AMD»; расхождение с суммой расхода — спокойная строка с подсказкой', async () => {
    server.parsePhoto = answer({ ...rows, total: null });
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '2191,32');
    await parsed(person);
    await person.click(screen.getByRole('button', { name: /^Позиции чека/ }));

    expect(screen.getByText('Сумма позиций 2 095,66 AMD')).toBeInTheDocument();
    const note = screen.getByText('Сумма расхода отличается от суммы позиций на 95,66 AMD');
    expect(note.closest('p')).toHaveAttribute(
      'title',
      'Бывают скидки, бонусы, чаевые и округление',
    );
    expect(note.closest('p')!.className).not.toContain('red');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('2 191,32');
  });

  it('разница меньше единицы: строки о расхождении нет', async () => {
    server.parsePhoto = answer({ ...rows, total: null });
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '2095,9');
    await parsed(person);
    await person.click(screen.getByRole('button', { name: /^Позиции чека/ }));

    expect(screen.getByText('Сумма позиций 2 095,66 AMD')).toBeInTheDocument();
    expect(screen.queryByText(/Сумма расхода отличается/)).toBeNull();
  });

  it('под полем суммы: «По чеку: … · Подставить» с иконкой', async () => {
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1000');
    await pickPhoto(person);

    const hint = (await screen.findByText(/По чеку: 1 500,50 AMD/)).closest('p')!;

    expect(within(hint).getByRole('button', { name: 'Подставить' })).toBeInTheDocument();
    expect(hint.querySelector('svg')).not.toBeNull();
  });
});
