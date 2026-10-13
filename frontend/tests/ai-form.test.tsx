import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import {
  enableAi,
  failure,
  fillForm,
  ok,
  renderApp,
  server,
  setOnLine,
  setupOfflineHarness,
  submit,
  type Person,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

const stubImaging = () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
  );
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas'
      ? Object.assign(real('canvas'), {
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: BlobCallback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })),
        })
      : real(tag)) as typeof document.createElement);
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
};

/** The photo is allowed for the category «кафе». */
function allowPhotos() {
  server.receiptSettings = { enabled: true, categories: ['кафе'] };
  stubImaging();
}

async function pickPhoto(person: Person) {
  await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
  await person.upload(
    await screen.findByLabelText('Выбрать фото чека'),
    new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
  );
  await screen.findByAltText('Фото чека');
}

const lastPost = () => server.posts().at(-1)!.body as Record<string, unknown>;

describe('позиции чека на «Добавить»', () => {
  it('по умолчанию скрыты: одна ссылка, ни одного поля', async () => {
    await renderApp();

    expect(screen.getByRole('button', { name: '+ Позиции чека' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Название позиции/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить позицию' })).toBeNull();
  });

  it('для участника без ИИ нет ничего про ИИ: ни плашки, ни необязательного названия', async () => {
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/Gemini/)).toBeNull();
    expect(screen.queryByPlaceholderText(/заполнит ИИ/)).toBeNull();
  });

  it('ссылка раскрывает строку «название, цена, количество»; крестик последней строки её закрывает', async () => {
    const { person } = await renderApp();

    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));

    expect(screen.getByLabelText('Название позиции 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Цена позиции 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Количество позиции 1')).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Добавить позицию' }));
    expect(screen.getByLabelText('Название позиции 2')).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Удалить позицию 2' }));
    await person.click(screen.getByRole('button', { name: 'Удалить позицию 1' }));
    expect(screen.getByRole('button', { name: '+ Позиции чека' })).toBeInTheDocument();
  });

  it('кнопки-иконки имеют aria-label и title', async () => {
    const { person } = await renderApp();
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));

    expect(screen.getByRole('button', { name: 'Добавить позицию' })).toHaveAttribute(
      'title',
      'Добавить позицию',
    );
    expect(screen.getByRole('button', { name: 'Удалить позицию 1' })).toHaveAttribute(
      'title',
      'Удалить позицию',
    );
  });

  it('позиции уходят в POST /expenses с дробными числами; без ИИ источники не шлются', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин', '2000');
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));
    await person.type(screen.getByLabelText('Название позиции 1'), 'Хлеб');
    await person.type(screen.getByLabelText('Цена позиции 1'), '1249,5');
    await person.type(screen.getByLabelText('Количество позиции 1'), '0.350');

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost().items).toEqual([{ name: 'Хлеб', price: 1249.5, quantity: 0.35 }]);
    expect(lastPost()).not.toHaveProperty('nameSource');
    expect(lastPost()).not.toHaveProperty('dateSource');
    // The editor is closed again after saving
    expect(screen.getByRole('button', { name: '+ Позиции чека' })).toBeInTheDocument();
  });

  it('пустая открытая строка не отправляется', async () => {
    const { person } = await renderApp();
    await fillForm(person);
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).not.toHaveProperty('items');
  });

  it('неполная позиция: понятная ошибка, запрос не уходит, введённое остаётся', async () => {
    const { person } = await renderApp();
    await fillForm(person);
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));
    await person.type(screen.getByLabelText('Название позиции 1'), 'Хлеб');

    await submit(person);

    expect(await screen.findByText('Позиция 1: укажите цену')).toBeInTheDocument();
    expect(server.posts()).toHaveLength(0);
    expect(screen.getByLabelText('Наименование')).toHaveValue('Кофе');
  });
});

describe('фото чека и ИИ на «Добавить»', () => {
  it('с ИИ и фото название необязательно: уходит «Чек», источники default', async () => {
    enableAi();
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    expect(screen.getByLabelText('Наименование')).toHaveAttribute(
      'placeholder',
      'Можно оставить пустым: заполнит ИИ',
    );
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({ name: 'Чек', nameSource: 'default', dateSource: 'default' });
  });

  it('введённое название и изменённая дата помечаются как manual', async () => {
    enableAi();
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Наименование'), 'Кофейня');
    await person.type(screen.getByLabelText('Стоимость'), '5000');
    const date = screen.getByLabelText('Дата');
    await person.clear(date);
    await person.type(date, '2026-10-01');

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(lastPost()).toMatchObject({
      name: 'Кофейня',
      nameSource: 'manual',
      dateSource: 'manual',
    });
  });

  it('без фото название обязательно и источники не шлются, даже когда ИИ включён', async () => {
    enableAi();
    const { person } = await renderApp();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);

    expect(await screen.findByText('Введите наименование')).toBeInTheDocument();
    expect(server.posts()).toHaveLength(0);
  });

  it('ИИ недоступен: с фото название обязательно, источники не шлются', async () => {
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);

    expect(await screen.findByText('Введите наименование')).toBeInTheDocument();
    expect(server.posts()).toHaveLength(0);
  });

  it('после сохранения и загрузки фото запускается разбор; индикатор, затем «Название, дата и позиции заполнены ИИ»', async () => {
    enableAi();
    let finish: (response: Response) => void = () => undefined;
    server.parseReceipt = () => new Promise<Response>((resolve) => (finish = resolve));
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);

    expect(await screen.findByText('ИИ обрабатывает чек…')).toBeInTheDocument();
    // The next expense can be typed meanwhile
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeEnabled();
    expect(server.puts().map((r) => r.url)).toEqual(['/api/expenses/srv-1/receipt']);
    expect(server.parses().map((r) => r.url)).toEqual(['/api/expenses/srv-1/receipt/parse']);
    finish(
      ok({
        nameFilled: true,
        dateFilled: true,
        itemsFilled: true,
        itemsOffered: false,
        dropped: 0,
        total: null,
        currency: null,
      }),
    );

    expect(await screen.findByText('Название, дата и позиции заполнены ИИ')).toBeInTheDocument();
    expect(screen.queryByText('ИИ обрабатывает чек…')).toBeNull();
  });

  it('ошибка разбора не ломает сохранение: расход сохранён, мягкое сообщение с причиной', async () => {
    enableAi();
    server.parseReceipt = () => failure(503, 'ИИ временно недоступен', 'AI_UNAVAILABLE');
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);

    expect(
      await screen.findByText(
        'Не удалось разобрать чек, заполните вручную. ИИ временно недоступен',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Расход успешно добавлен')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('сбой загрузки фото: разбор не запускается', async () => {
    enableAi();
    server.putReceipt = () => failure(422, 'Не JPEG');
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Стоимость'), '5000');

    await submit(person);

    await screen.findByText(/фото не загрузилось/);
    expect(server.parses()).toHaveLength(0);
  });

  it('без фото разбор не запускается', async () => {
    enableAi();
    const { person } = await renderApp();
    await fillForm(person);

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(server.parses()).toHaveLength(0);
  });
});

describe('плашка про Google (Gemini)', () => {
  it('при первом фото: плашка; «Понятно» сохраняет предпочтение и скрывает её', async () => {
    enableAi();
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);

    expect(
      await screen.findByText('Чек будет отправлен на разбор в Google (Gemini)'),
    ).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Понятно' }));

    await waitFor(() => expect(server.preferences).toEqual({ 'ai.noticeSeen': true }));
    expect(screen.queryByText(/Gemini/)).toBeNull();
  });

  it('уже подтверждённая — не показывается', async () => {
    enableAi();
    server.preferences = { 'ai.noticeSeen': true };
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.queryByText(/Gemini/)).toBeNull();
  });

  it('до выбора фото её нет', async () => {
    enableAi();
    await renderApp();

    expect(screen.queryByText(/Gemini/)).toBeNull();
  });
});

describe('ИИ и очередь без сети', () => {
  it('позиции, источники и признак разбора сохраняются в записи очереди', async () => {
    enableAi();
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    setOnLine(false);
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
    expect(record!.photo).toBeInstanceOf(Blob);
  });

  it('когда сеть вернулась: расход, фото, затем разбор; запись удалена', async () => {
    enableAi();
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    setOnLine(false);
    server.network = false;
    await person.type(screen.getByLabelText('Стоимость'), '5000');
    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');

    server.network = true;
    setOnLine(true);

    await waitFor(async () => expect(await queueStore.list()).toEqual([]));
    await waitFor(() => expect(server.parses()).toHaveLength(1));
    expect(lastPost()).toMatchObject({ name: 'Чек', nameSource: 'default' });
    expect(server.puts()).toHaveLength(1);
    expect(server.parses()[0]!.url).toBe('/api/expenses/srv-1/receipt/parse');
  });

  it('без признака разбора (ИИ был выключен) запись уходит без разбора', async () => {
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person);
    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');
    expect((await queueStore.list())[0]).not.toHaveProperty('parse');
  });

  it('«Изменить» возвращает позиции записи в форму', async () => {
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person);
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));
    await person.type(screen.getByLabelText('Название позиции 1'), 'Хлеб');
    await person.type(screen.getByLabelText('Цена позиции 1'), '1249,5');
    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');

    await person.click(await screen.findByRole('button', { name: /Не отправлено: 1/ }));
    await person.click(
      within(screen.getByRole('region', { name: 'Не отправлено' })).getByRole('button', {
        name: 'Изменить',
      }),
    );

    await waitFor(() => expect(screen.getByLabelText('Название позиции 1')).toHaveValue('Хлеб'));
    expect(screen.getByLabelText('Цена позиции 1')).toHaveValue('1 249,5');
  });
});
