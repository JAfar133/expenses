import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import {
  allowPhotos,
  enableAi,
  failure,
  fillForm,
  ok,
  pickPhoto,
  stubImaging,
  renderApp,
  server,
  setOnLine,
  setupOfflineHarness,
  submit,
  type Person,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

const AI = 'Сгенерировано с помощью AI';
const NOTICE = 'Чек будет отправлен на разбор в Google (Gemini)';
const lastPost = () => server.posts().at(-1)!.body as Record<string, unknown>;

/** The AI is on, photos are allowed and the notice was already confirmed. */
async function ready(confirmed = true) {
  enableAi();
  allowPhotos();
  // Photos and the AI in both categories
  server.receiptSettings = { enabled: true, categories: ['кафе', 'продукты'] };
  if (confirmed) server.preferences = { 'ai.noticeSeen': true };
  return renderApp();
}

/** Unfolds the positions card; `edit` also switches it to the editing view. */
async function openItems(person: Person, edit = false) {
  await person.click(await screen.findByRole('button', { name: /^Позиции чека \(/ }));
  if (edit) await person.click(screen.getByRole('radio', { name: 'Редактирование' }));
}

const labelOf = (text: string) => screen.getByText(text, { selector: 'label' });

describe('разбор чека при выборе фото', () => {
  it('пока плашка не подтверждена, фото никуда не уходит; «Понятно» сохраняет предпочтение и запускает разбор', async () => {
    const { person } = await ready(false);

    await pickPhoto(person);

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.photoParses()).toHaveLength(0);

    await person.click(screen.getByRole('button', { name: 'Понятно' }));

    await waitFor(() => expect(server.preferences).toEqual({ 'ai.noticeSeen': true }));
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
  });

  it('уже подтверждено: разбор стартует сразу после выбора фото, плашки нет; фото уходит как есть', async () => {
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(screen.queryByText(NOTICE)).toBeNull();
    const request = server.photoParses()[0]!;
    expect(request.headers.get('Content-Type')).toBe('image/jpeg');
    expect(request.body).toBeInstanceOf(Blob);
  });

  it('ИИ недоступен или фото не разрешено: разбор не идёт', async () => {
    allowPhotos();
    const { person } = await renderApp();

    await pickPhoto(person);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(server.photoParses()).toHaveLength(0);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('пока идёт разбор: «Распознаём чек…», форму можно заполнять, «Добавить» остаётся', async () => {
    let finish: (response: Response) => void = () => undefined;
    server.parsePhoto = () => new Promise<Response>((resolve) => (finish = resolve));
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText('Распознаём чек…')).toBeInTheDocument();
    expect(screen.getByLabelText('Наименование')).toHaveClass('animate-pulse');
    await person.type(screen.getByLabelText('Стоимость'), '1500');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('1 500');
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeEnabled();
    finish(
      ok({
        parseId: 'p1',
        name: 'Кофейня',
        date: null,
        items: [],
        total: null,
        currency: null,
        dropped: 0,
      }),
    );

    await waitFor(() => expect(screen.queryByText('Распознаём чек…')).toBeNull());
  });

  it('результат заполняет название, дату и позиции с пометкой AI; сумма не трогается', async () => {
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1500');

    await pickPhoto(person);

    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-09-30');
    // The positions come as a folded card with the count and the sum; unfolded, the simple view is the default
    const card = screen.getByRole('button', { name: /^Позиции чека \(1\)/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(card).toHaveTextContent('1 500 AMD');
    await person.click(card);
    const row = within(screen.getByRole('list', { name: 'Позиции' })).getByRole('listitem');
    expect(row).toHaveTextContent('Латте');
    expect(row).toHaveTextContent('1 500');
    expect(within(row).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(screen.getByLabelText('Стоимость')).toHaveValue('1 500');
    expect(within(labelOf('Наименование')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(within(labelOf('Дата')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: AI }).length).toBeGreaterThanOrEqual(3);
  });

  it('правка названия, даты и позиции снимает пометку именно с них', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    await person.type(screen.getByLabelText('Наименование'), '!');
    expect(within(labelOf('Наименование')).queryByRole('img', { name: AI })).toBeNull();
    expect(within(labelOf('Дата')).getByRole('img', { name: AI })).toBeInTheDocument();

    await openItems(person, true);
    expect(
      within(screen.getByLabelText('Название позиции 1').closest('li')!).getByRole('img', {
        name: AI,
      }),
    ).toBeInTheDocument();
    await person.type(screen.getByLabelText('Название позиции 1'), 'ы');
    expect(
      within(screen.getByLabelText('Название позиции 1').closest('li')!).queryByRole('img', {
        name: AI,
      }),
    ).toBeNull();

    const date = screen.getByLabelText('Дата');
    await person.clear(date);
    await person.type(date, '2026-10-01');
    expect(within(labelOf('Дата')).queryByRole('img', { name: AI })).toBeNull();
  });

  it('введённое человеком не перезаписывается: название, дата и свои позиции', async () => {
    const { person } = await ready();
    await person.type(screen.getByLabelText('Наименование'), 'Моё название');
    const date = screen.getByLabelText('Дата');
    await person.clear(date);
    await person.type(date, '2026-10-02');
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));
    await person.type(screen.getByLabelText('Название позиции 1'), 'Своя');
    await person.type(screen.getByLabelText('Цена позиции 1'), '7');

    await pickPhoto(person);
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Распознаём чек…')).toBeNull());

    expect(screen.getByLabelText('Наименование')).toHaveValue('Моё название');
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-10-02');
    expect(screen.getByLabelText('Название позиции 1')).toHaveValue('Своя');
    expect(screen.queryByLabelText('Название позиции 2')).toBeNull();
  });

  it('итог на чеке, который отличается от введённой суммы: серая подсказка; сумма не подставляется', async () => {
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1000');

    await pickPhoto(person);

    expect(await screen.findByText(/По чеку: 1 500,50 AMD/)).toBeInTheDocument();
    expect(screen.getByLabelText('Стоимость')).toHaveValue('1 000');
  });

  it('итог совпал с суммой и позициями: подсказки нет', async () => {
    server.parsePhoto = () =>
      ok({
        parseId: 'p1',
        name: 'Кофейня',
        date: null,
        items: [{ name: 'Латте', price: 1500, quantity: 1 }],
        total: 1500,
        currency: 'AMD',
        dropped: 0,
      });
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1500');

    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    expect(screen.queryByText(/По чеку: /)).toBeNull();
  });
});

describe('сохранение после разбора', () => {
  it('уходит с aiParseId и тем, что в форме; без источников и без повторного разбора после сохранения', async () => {
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1500');
    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({
      aiParseId: 'p1',
      name: 'Кофейня',
      date: '2026-09-30',
      items: [{ name: 'Латте', price: 1500 }],
    });
    expect(lastPost()).not.toHaveProperty('nameSource');
    expect(lastPost()).not.toHaveProperty('dateSource');
    expect(server.puts()).toHaveLength(1);
    expect(server.parses()).toHaveLength(0);
  });

  it('нажатие «Добавить» во время разбора: ждём результат, затем сохраняем с заполненной формой и aiParseId', async () => {
    let finish: (response: Response) => void = () => undefined;
    server.parsePhoto = () => new Promise<Response>((resolve) => (finish = resolve));
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1500');
    await pickPhoto(person);
    await screen.findByText('Распознаём чек…');

    await submit(person);

    expect(await screen.findByRole('button', { name: 'Ждём разбор чека…' })).toBeInTheDocument();
    expect(server.posts()).toHaveLength(0);
    finish(
      ok({
        parseId: 'p7',
        name: 'Кофейня',
        date: null,
        items: [],
        total: null,
        currency: null,
        dropped: 0,
      }),
    );

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({ aiParseId: 'p7', name: 'Кофейня' });
  });

  it('ошибка разбора: мягкая плашка с текстом сервера и «Повторить»; сохранение не блокируется', async () => {
    server.parsePhoto = () =>
      failure(429, 'Лимит разборов на сегодня исчерпан', 'AI_LIMIT_REACHED');
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1500');
    await pickPhoto(person);

    expect(await screen.findByText(/Лимит разборов на сегодня исчерпан/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await person.type(screen.getByLabelText('Наименование'), 'Вручную');
    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).not.toHaveProperty('aiParseId');
    // The photo is saved with the expense, nothing is parsed after saving
    expect(server.puts()).toHaveLength(1);
    expect(server.parses()).toHaveLength(0);
  });

  it('«Повторить» запускает разбор заново', async () => {
    let calls = 0;
    server.parsePhoto = () =>
      ++calls === 1
        ? failure(503, 'ИИ временно недоступен', 'AI_UNAVAILABLE')
        : ok({
            parseId: 'p2',
            name: 'Кофейня',
            date: null,
            items: [],
            total: null,
            currency: null,
            dropped: 0,
          });
    const { person } = await ready();
    await pickPhoto(person);
    await person.click(await screen.findByRole('button', { name: 'Повторить' }));

    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
    expect(server.photoParses()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('фото убрали: прежний parseId сбрасывается, расход уходит без него', async () => {
    const { person } = await ready();
    await person.type(screen.getByLabelText('Стоимость'), '1500');
    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));
    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).not.toHaveProperty('aiParseId');
    expect(server.puts()).toHaveLength(0);
  });

  it('другое фото: разбор заново, прежние значения ИИ перезаписываются, пока их не правили', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');
    server.parsePhoto = () =>
      ok({
        parseId: 'p2',
        name: 'Пекарня',
        date: null,
        items: [{ name: 'Хлеб', price: 300, quantity: 1 }],
        total: null,
        currency: null,
        dropped: 0,
      });

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));
    await pickPhoto(person);

    expect(await screen.findByDisplayValue('Пекарня')).toBeInTheDocument();
    await openItems(person);
    expect(
      within(screen.getByRole('list', { name: 'Позиции' })).getByRole('listitem'),
    ).toHaveTextContent('Хлеб');
    expect(server.photoParses()).toHaveLength(2);
  });
});

describe('очередь без сети и разбор', () => {
  async function offlineWithPhoto() {
    const { person } = await ready();
    server.network = false;
    setOnLine(false);
    await pickPhoto(person);
    return person;
  }

  it('без сети разбор до сохранения невозможен: запись очереди помечена на разбор после отправки', async () => {
    const person = await offlineWithPhoto();
    await person.type(screen.getByLabelText('Стоимость'), '5000');
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));
    await person.type(screen.getByLabelText('Название позиции 1'), 'Хлеб');
    await person.type(screen.getByLabelText('Цена позиции 1'), '99,5');

    await submit(person);

    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');
    const [record] = await queueStore.list();
    expect(record).toMatchObject({
      parse: true,
      expense: {
        name: 'Чек',
        nameSource: 'default',
        dateSource: 'default',
        items: [{ name: 'Хлеб', price: 99.5 }],
      },
    });
    expect(record!.expense).not.toHaveProperty('aiParseId');
    expect(record!.photo).toBeInstanceOf(Blob);
  });

  it('когда сеть вернулась: расход, фото, затем разбор после сохранения; запись удалена', async () => {
    const person = await offlineWithPhoto();
    await person.type(screen.getByLabelText('Стоимость'), '5000');
    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');

    server.network = true;
    setOnLine(true);

    await waitFor(async () => expect(await queueStore.list()).toEqual([]));
    await waitFor(() => expect(server.parses()).toHaveLength(1));
    expect(server.parses()[0]!.url).toBe('/api/expenses/srv-1/receipt/parse');
    expect(server.puts()).toHaveLength(1);
  });

  it('без подтверждённой плашки разбор после отправки не запрашивается', async () => {
    enableAi();
    allowPhotos();
    const { person } = await renderApp();
    server.network = false;
    setOnLine(false);
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Стоимость'), '5000');
    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');

    expect((await queueStore.list())[0]).not.toHaveProperty('parse');
  });
});

describe('заполнение формы без лишнего', () => {
  it('название, введённое вручную после результата, уходит как есть', async () => {
    const { person } = await ready();
    await fillForm(person, 'Ручное', '2000');
    await pickPhoto(person);
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Распознаём чек…')).toBeNull());

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({ name: 'Ручное', aiParseId: 'p1' });
  });
});

describe('сумма из чека', () => {
  const answer = (patch: Record<string, unknown>) => () =>
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
  const amount = () => screen.getByLabelText('Стоимость');

  it('дробная сумма подставляется всегда с двумя знаками, целая без знаков', async () => {
    server.parsePhoto = answer({ total: 1500 });
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(amount()).toHaveValue('1 500'));
  });

  it('пустое поле суммы получает итог с чека, с пометкой AI; подсказки про итог нет', async () => {
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(amount()).toHaveValue('1 500,50'));
    expect(within(labelOf('Стоимость')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(screen.queryByText(/По чеку: /)).toBeNull();
  });

  it('итога нет: подставляется сумма позиций, в том числе дробная 2095,66', async () => {
    server.parsePhoto = answer({
      items: [
        { name: 'Сыр', price: 1000.1, quantity: 1 },
        { name: 'Хлеб', price: 1095.56, quantity: 1 },
      ],
    });
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(amount()).toHaveValue('2 095,66'));
    // The hint is only for a total that came from the receipt
    expect(screen.queryByText(/По чеку: /)).toBeNull();
  });

  it('нет ни итога, ни позиций: сумма остаётся пустой', async () => {
    server.parsePhoto = answer({});
    const { person } = await ready();

    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    expect(amount()).toHaveValue('');
    expect(within(labelOf('Стоимость')).queryByRole('img', { name: AI })).toBeNull();
  });

  it('введённая руками сумма не меняется; серая подсказка про итог остаётся', async () => {
    const { person } = await ready();
    await person.type(amount(), '1000');

    await pickPhoto(person);

    expect(await screen.findByText(/По чеку: 1 500,50 AMD/)).toBeInTheDocument();
    expect(amount()).toHaveValue('1 000');
    expect(within(labelOf('Стоимость')).queryByRole('img', { name: AI })).toBeNull();
  });

  it('другая валюта на чеке: сумма не подставляется, подсказка с валютой остаётся', async () => {
    server.parsePhoto = answer({ total: 12.5, currency: 'USD' });
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText(/По чеку: 12,50 USD/)).toBeInTheDocument();
    expect(amount()).toHaveValue('');
  });

  it('пометка снимается при правке суммы', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await waitFor(() => expect(amount()).toHaveValue('1 500,50'));

    await person.type(amount(), '{Backspace}');

    expect(within(labelOf('Стоимость')).queryByRole('img', { name: AI })).toBeNull();
  });

  it('правка позиций сумму не пересчитывает', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await waitFor(() => expect(amount()).toHaveValue('1 500,50'));

    await openItems(person, true);
    const price = screen.getByLabelText('Цена позиции 1');
    await person.clear(price);
    await person.type(price, '99');

    expect(amount()).toHaveValue('1 500,50');
  });

  it('другое фото: сумма, помеченная ИИ, перезаписывается; правленая рукой — нет', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await waitFor(() => expect(amount()).toHaveValue('1 500,50'));
    server.parsePhoto = answer({ parseId: 'p2', total: 300 });
    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));
    await pickPhoto(person);
    await waitFor(() => expect(amount()).toHaveValue('300'));

    await person.type(amount(), '5');
    server.parsePhoto = answer({ parseId: 'p3', total: 777 });
    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));
    await pickPhoto(person);
    await waitFor(() => expect(server.photoParses()).toHaveLength(3));

    expect(amount()).toHaveValue('3 005');
  });

  it('сохранение: подставленная сумма уходит как обычная', async () => {
    const { person } = await ready();
    await pickPhoto(person);
    await waitFor(() => expect(amount()).toHaveValue('1 500,50'));

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({ amount: 1500.5, aiParseId: 'p1' });
  });
});

describe('подсказка про итог под полем суммы', () => {
  const amount = () => screen.getByLabelText('Стоимость');
  const hintOf = () => screen.getByText(/По чеку: 1 500,50 AMD/).closest('p')!;

  it('под полем суммы, а не под фото: «По чеку: 1 500,50 AMD» и ссылка «Подставить»', async () => {
    const { person } = await ready();
    await person.type(amount(), '1000');

    await pickPhoto(person);
    await screen.findByText(/По чеку: 1 500,50 AMD/);

    expect(within(hintOf()).getByRole('button', { name: 'Подставить' })).toBeInTheDocument();
    expect(screen.getAllByText(/По чеку: /)).toHaveLength(1);
    expect(hintOf().className).toContain('text-zinc-500');
    expect(hintOf().className).not.toContain('red');
  });

  it('«Подставить» ставит итог в поле с пометкой AI, строка исчезает', async () => {
    const { person } = await ready();
    await person.type(amount(), '1000');
    await pickPhoto(person);
    await screen.findByText(/По чеку: 1 500,50 AMD/);

    await person.click(screen.getByRole('button', { name: 'Подставить' }));

    expect(amount()).toHaveValue('1 500,50');
    expect(within(labelOf('Стоимость')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(screen.queryByText(/По чеку: /)).toBeNull();
  });

  it('разница меньше единицы или сумма уже равна: строки нет', async () => {
    const { person } = await ready();
    await person.type(amount(), '1500,2');

    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    expect(screen.queryByText(/По чеку: /)).toBeNull();
  });

  it('другая валюта: валюта в строке, ссылки «Подставить» нет', async () => {
    server.parsePhoto = () =>
      ok({
        parseId: 'p1',
        name: 'Кофейня',
        date: null,
        items: [],
        total: 12.5,
        currency: 'USD',
        dropped: 0,
      });
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText(/По чеку: 12,50 USD/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подставить' })).toBeNull();
  });

  it('сумма посчитана из позиций, итога на чеке нет: строки нет', async () => {
    server.parsePhoto = () =>
      ok({
        parseId: 'p1',
        name: 'Кофейня',
        date: null,
        items: [{ name: 'Сыр', price: 2095.66, quantity: 1 }],
        total: null,
        currency: null,
        dropped: 0,
      });
    const { person } = await ready();
    await person.type(amount(), '1000');

    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    expect(screen.queryByText(/По чеку: /)).toBeNull();
  });
});

describe('ИИ по категориям', () => {
  /** Photos are allowed in «кафе» and «продукты», the AI only in «продукты». */
  async function readyWithAiOnlyInGroceries() {
    enableAi();
    server.receiptSettings = {
      enabled: true,
      categories: ['кафе', 'продукты'],
      aiCategories: ['продукты'],
    };
    server.preferences = { 'ai.noticeSeen': true };
    stubImaging();
    return renderApp();
  }

  it('категория без ИИ: фото прикрепляется, но нет плашки, запроса и индикатора', async () => {
    const { person } = await readyWithAiOnlyInGroceries();

    await pickPhoto(person);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByAltText('Фото чека')).toBeInTheDocument();
    expect(server.photoParses()).toHaveLength(0);
    expect(screen.queryByText(/Gemini/)).toBeNull();
    expect(screen.queryByText('Распознаём чек…')).toBeNull();
  });

  it('категория без ИИ: название обязательно, расход уходит с фото без разбора', async () => {
    const { person } = await readyWithAiOnlyInGroceries();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);
    expect(await screen.findByText('Введите наименование')).toBeInTheDocument();
    await person.type(screen.getByLabelText('Наименование'), 'Кофе');
    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).not.toHaveProperty('aiParseId');
    expect(lastPost()).not.toHaveProperty('nameSource');
    expect(server.puts()).toHaveLength(1);
    expect(server.parses()).toHaveLength(0);
  });

  it('категория с ИИ: разбор идёт, в запросе ?category= с названием категории', async () => {
    const { person } = await readyWithAiOnlyInGroceries();
    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');
    await person.upload(
      await screen.findByLabelText('Выбрать фото чека'),
      new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(server.photoParses()[0]!.url).toBe(
      `/api/ai/receipt/parse?category=${encodeURIComponent('продукты')}`,
    );
  });

  it('смена категории на разрешённую: разбор запускается для уже прикреплённого фото', async () => {
    const { person } = await readyWithAiOnlyInGroceries();
    await pickPhoto(person);
    expect(server.photoParses()).toHaveLength(0);

    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');

    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(server.photoParses()[0]!.url).toContain(encodeURIComponent('продукты'));
    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
  });

  it('смена на запрещённую категорию: прежние значения ИИ остаются, нового разбора нет, aiParseId не уходит', async () => {
    const { person } = await readyWithAiOnlyInGroceries();
    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');
    await person.upload(
      await screen.findByLabelText('Выбрать фото чека'),
      new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByDisplayValue('Кофейня');

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');

    expect(screen.getByLabelText('Наименование')).toHaveValue('Кофейня');
    expect(server.photoParses()).toHaveLength(1);
    expect(screen.queryByText('Распознаём чек…')).toBeNull();
    await person.type(screen.getByLabelText('Стоимость'), '5000');
    await submit(person);
    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).not.toHaveProperty('aiParseId');
  });

  it('категория выключена после выбора фото (409 AI_CATEGORY_OFF): мягкая плашка, сохранение не блокируется', async () => {
    server.parsePhoto = () =>
      failure(
        409,
        'Для этой категории разбор чеков с помощью ИИ выключен владельцем группы',
        'AI_CATEGORY_OFF',
      );
    const { person } = await ready();

    await pickPhoto(person);

    expect(
      await screen.findByText(/разбор чеков с помощью ИИ выключен владельцем группы/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeEnabled();
  });

  it('сервер без списка aiCategories считается «ИИ везде»', async () => {
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
  });
});

describe('подсказка категории от ИИ', () => {
  const answerWith = (category: string | null) => () =>
    ok({
      parseId: 'p1',
      category,
      name: 'Кофейня',
      date: null,
      items: [],
      total: null,
      currency: null,
      dropped: 0,
    });
  const hint = () => screen.queryByText(/ИИ считает:/);

  it('человек выбрал «кафе», ИИ считает «продукты»: спокойная строка с «Выбрать»', async () => {
    server.parsePhoto = answerWith('продукты');
    const { person } = await ready();

    await pickPhoto(person);

    const line = (await screen.findByText('ИИ считает: продукты')).closest('p')!;
    expect(line.className).toContain('text-zinc-500');
    expect(line.className).not.toContain('red');
    expect(within(line).getByRole('button', { name: 'Выбрать' })).toBeInTheDocument();
    expect(screen.getByLabelText('Категория')).toHaveValue('кафе');
  });

  it('«Выбрать» ставит категорию с пометкой AI, строка исчезает', async () => {
    server.parsePhoto = answerWith('продукты');
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByText('ИИ считает: продукты');

    await person.click(screen.getByRole('button', { name: 'Выбрать' }));

    expect(screen.getByLabelText('Категория')).toHaveValue('продукты');
    expect(within(labelOf('Категория')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(hint()).toBeNull();
  });

  it('совпадает с выбранной или category null: строки нет', async () => {
    server.parsePhoto = answerWith('кафе');
    const first = await ready();
    await pickPhoto(first.person);
    await screen.findByDisplayValue('Кофейня');
    expect(hint()).toBeNull();
  });

  it('category null: строки нет', async () => {
    server.parsePhoto = answerWith(null);
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByDisplayValue('Кофейня');

    expect(hint()).toBeNull();
  });

  it('ручная смена на предложенную убирает строку, смена на третью оставляет её', async () => {
    server.parsePhoto = answerWith('продукты');
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByText('ИИ считает: продукты');

    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');
    expect(hint()).toBeNull();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');

    expect(await screen.findByText('ИИ считает: продукты')).toBeInTheDocument();
  });

  it('фото убрано: строка исчезает', async () => {
    server.parsePhoto = answerWith('продукты');
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByText('ИИ считает: продукты');

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));

    expect(hint()).toBeNull();
  });

  it('не мешает сохранению с выбранной человеком категорией', async () => {
    server.parsePhoto = answerWith('продукты');
    const { person } = await ready();
    await pickPhoto(person);
    await screen.findByText('ИИ считает: продукты');
    await person.type(screen.getByLabelText('Стоимость'), '500');

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({ category: 'кафе', aiParseId: 'p1' });
  });
});

describe('подсказка названия от ИИ', () => {
  const answerName = (name: string | null) => () =>
    ok({
      parseId: 'p1',
      category: null,
      name,
      date: null,
      items: [],
      total: null,
      currency: null,
      dropped: 0,
    });
  const hint = () => screen.queryByText(/ИИ предлагает:/);

  async function withTypedName(typed: string) {
    const app = await ready();
    await app.person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await app.person.type(screen.getByLabelText('Наименование'), typed);
    return app;
  }

  it('человек ввёл своё название, ИИ прочитал другое: спокойная строка с «Выбрать»', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await withTypedName('Магазин у дома');

    await pickPhoto(person);

    const line = (await screen.findByText('ИИ предлагает: Carrefour')).closest('p')!;
    expect(line.className).toContain('text-zinc-500');
    expect(line.className).not.toContain('red');
    expect(screen.getByLabelText('Наименование')).toHaveValue('Магазин у дома');
  });

  it('«Выбрать» подставляет название с пометкой AI, строка исчезает; ручная правка снимает пометку', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await withTypedName('Магазин у дома');
    await pickPhoto(person);
    await screen.findByText('ИИ предлагает: Carrefour');

    await person.click(screen.getByRole('button', { name: 'Выбрать' }));

    expect(screen.getByLabelText('Наименование')).toHaveValue('Carrefour');
    expect(within(labelOf('Наименование')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(hint()).toBeNull();
    await person.type(screen.getByLabelText('Наименование'), '!');
    expect(within(labelOf('Наименование')).queryByRole('img', { name: AI })).toBeNull();
  });

  it('совпадение без учёта регистра и крайних пробелов: строки нет', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await withTypedName('  carrefour ');

    await pickPhoto(person);
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Распознаём чек…')).toBeNull());

    expect(hint()).toBeNull();
  });

  it('name null: строки нет', async () => {
    server.parsePhoto = answerName(null);
    const { person } = await withTypedName('Магазин');

    await pickPhoto(person);
    await waitFor(() => expect(screen.queryByText('Распознаём чек…')).toBeNull());

    expect(hint()).toBeNull();
  });

  it('поле пустое: прежняя автоподстановка, подсказки нет', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByDisplayValue('Carrefour')).toBeInTheDocument();
    expect(hint()).toBeNull();
  });

  it('сравнение всегда с текущим значением: совпало — исчезает, сменил на другое — возвращается', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await withTypedName('Магазин');
    await pickPhoto(person);
    await screen.findByText('ИИ предлагает: Carrefour');

    const field = screen.getByLabelText('Наименование');
    await person.clear(field);
    await person.type(field, 'Carrefour');
    expect(hint()).toBeNull();
    await person.clear(field);
    await person.type(field, 'Другое');

    expect(await screen.findByText('ИИ предлагает: Carrefour')).toBeInTheDocument();
  });

  it('фото убрано: строка исчезает', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await withTypedName('Магазин');
    await pickPhoto(person);
    await screen.findByText('ИИ предлагает: Carrefour');

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));

    expect(hint()).toBeNull();
  });

  it('фото заменено: строка исчезает до нового ответа и приходит новая', async () => {
    server.parsePhoto = answerName('Carrefour');
    const { person } = await withTypedName('Магазин');
    await pickPhoto(person);
    await screen.findByText('ИИ предлагает: Carrefour');
    server.parsePhoto = answerName('Spar');

    await person.upload(
      screen.getByLabelText('Выбрать фото чека'),
      new File(['img2'], 'second.jpg', { type: 'image/jpeg' }),
    );

    expect(await screen.findByText('ИИ предлагает: Spar')).toBeInTheDocument();
    expect(hint()).not.toHaveTextContent('Carrefour');
  });

  it('не мешает сохранению и не смешивается с чипами истории', async () => {
    server.parsePhoto = answerName('Carrefour');
    server.nameSuggestions = [{ name: 'Магазин у дома', category: 'кафе', count: 5 }];
    const { person } = await withTypedName('Магаз');
    await pickPhoto(person);
    const line = await screen.findByText('ИИ предлагает: Carrefour');

    const chip = screen.getByRole('button', { name: /Магазин у дома/ });
    expect(chip.closest('p')).toBeNull();
    expect(chip).not.toBe(line);
    expect(line.closest('p')!.contains(chip)).toBe(false);
    await person.type(screen.getByLabelText('Стоимость'), '500');
    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({ name: 'Магаз', aiParseId: 'p1' });
  });
});

describe('валюта чека', () => {
  const RATES = {
    base: 'AMD',
    currencies: ['AMD', 'RUB', 'USD'],
    rates: [{ currency: 'RUB', rate: 4.8, fetchedAt: '2026-10-15T00:00:00Z' }],
  };
  const receipt = (patch: Record<string, unknown>) => () =>
    ok({
      parseId: 'p1',
      category: null,
      name: 'Магазин',
      date: null,
      items: [],
      total: 3810,
      currency: 'RUB',
      dropped: 0,
      ...patch,
    });
  const amount = () => screen.getByLabelText('Стоимость');
  const currency = () => screen.getByLabelText('Валюта') as HTMLSelectElement;

  it('чек в рублях при карте в драмах: валюта ввода переключается на RUB, подставляется итог с пометкой AI, курс подтянут', async () => {
    server.rates = RATES;
    server.parsePhoto = receipt({});
    const { person } = await ready();
    expect(await screen.findByLabelText('Валюта')).toHaveValue('AMD');

    await pickPhoto(person);

    await waitFor(() => expect(amount()).toHaveValue('3 810'));
    expect(currency()).toHaveValue('RUB');
    expect(within(labelOf('Стоимость')).getByRole('img', { name: AI })).toBeInTheDocument();
    expect(screen.getByLabelText(/Курс/)).toHaveValue('4,8');
    expect(screen.queryByText(/По чеку:/)).toBeNull();
  });

  it('итога нет: сумма позиций в валюте чека', async () => {
    server.rates = RATES;
    server.parsePhoto = receipt({
      total: null,
      items: [
        { name: 'Сыр', price: 1000.5, quantity: 1 },
        { name: 'Хлеб', price: 2809.5, quantity: 1 },
      ],
    });
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(amount()).toHaveValue('3 810'));
    expect(currency()).toHaveValue('RUB');
  });

  it('валюты чека нет среди доступных: суммы нет, только подсказка с этой валютой без «Подставить»', async () => {
    server.rates = RATES;
    server.parsePhoto = receipt({ currency: 'GBP' });
    const { person } = await ready();

    await pickPhoto(person);

    expect(await screen.findByText(/По чеку: 3 810 GBP/)).toBeInTheDocument();
    expect(amount()).toHaveValue('');
    expect(currency()).toHaveValue('AMD');
    expect(screen.queryByRole('button', { name: 'Подставить' })).toBeNull();
  });

  it('сумма введена руками: не трогается; «Подставить» переключает валюту и ставит сумму', async () => {
    server.rates = RATES;
    server.parsePhoto = receipt({});
    const { person } = await ready();
    await person.type(amount(), '2000');

    await pickPhoto(person);

    const hint = (await screen.findByText(/По чеку: 3 810 RUB/)).closest('p')!;
    expect(amount()).toHaveValue('2 000');
    expect(currency()).toHaveValue('AMD');

    await person.click(within(hint).getByRole('button', { name: 'Подставить' }));

    expect(currency()).toHaveValue('RUB');
    expect(amount()).toHaveValue('3 810');
    expect(within(labelOf('Стоимость')).getByRole('img', { name: AI })).toBeInTheDocument();
  });

  it('в ответе нет валюты: считается валютой ввода, она не меняется', async () => {
    server.rates = RATES;
    server.parsePhoto = receipt({ currency: null });
    const { person } = await ready();

    await pickPhoto(person);

    await waitFor(() => expect(amount()).toHaveValue('3 810'));
    expect(currency()).toHaveValue('AMD');
  });

  it('сумма позиций и расхождение считаются в валюте ввода (RUB после переключения)', async () => {
    server.rates = RATES;
    server.parsePhoto = receipt({ items: [{ name: 'Сыр', price: 3800, quantity: 1 }] });
    const { person } = await ready();

    await pickPhoto(person);
    await waitFor(() => expect(currency()).toHaveValue('RUB'));
    await person.click(screen.getByRole('button', { name: /^Позиции чека/ }));

    expect(screen.getByText('Сумма позиций 3 800,00 RUB')).toBeInTheDocument();
    expect(
      screen.getByText('Сумма расхода отличается от суммы позиций на 10,00 RUB'),
    ).toBeInTheDocument();
  });
});
