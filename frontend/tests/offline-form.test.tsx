import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import {
  failure,
  fillForm,
  renderApp,
  server,
  setOnLine,
  setupOfflineHarness,
  submit,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

const QUEUED = 'Сохранено на устройстве, отправится при появлении сети';

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

describe('форма без сети', () => {
  it('нет сети: расход кладётся в очередь, запрос не уходит, форма очищена, показано сообщение', async () => {
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person);

    await submit(person);

    expect(await screen.findByText(QUEUED)).toBeInTheDocument();
    expect(server.posts()).toHaveLength(0);
    expect(screen.getByLabelText('Наименование')).toHaveValue('');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('');
    const [item] = await queueStore.list();
    expect(item).toMatchObject({
      status: 'pending',
      attempts: 0,
      expense: { card: 'Миша', category: 'кафе', name: 'Кофе', amount: 1000 },
    });
    expect(item!.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('сетевая ошибка (ответа нет): расход в очереди, без ошибки на экране', async () => {
    const { person } = await renderApp();
    await fillForm(person);
    server.network = false;

    await submit(person);

    expect(await screen.findByText(QUEUED)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await queueStore.list()).toHaveLength(1);
    expect(screen.getByLabelText('Наименование')).toHaveValue('');
  });

  it.each([502, 503, 504])('ответ %i: расход в очереди', async (status) => {
    const { person } = await renderApp();
    await fillForm(person);
    server.postExpense = () => failure(status, 'Шлюз недоступен');

    await submit(person);

    expect(await screen.findByText(QUEUED)).toBeInTheDocument();
    expect(await queueStore.list()).toHaveLength(1);
  });

  it.each([
    [422, 'Карта не найдена'],
    [403, 'Нет доступа к карте'],
    [400, 'Некорректная сумма'],
  ])(
    'ответ %i: ошибка показана и в очередь НЕ попадает; поля остаются',
    async (status, message) => {
      const { person } = await renderApp();
      await fillForm(person);
      server.postExpense = () => failure(status, message);

      await submit(person);

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(await queueStore.list()).toEqual([]);
      expect(screen.getByLabelText('Наименование')).toHaveValue('Кофе');
      expect(screen.queryByText(QUEUED)).toBeNull();
    },
  );

  it('ключ идемпотентности записи равен ключу, под которым форма пыталась отправить', async () => {
    const { person } = await renderApp();
    await fillForm(person);
    server.postExpense = () => failure(503, 'x');

    await submit(person);
    await screen.findByText(QUEUED);

    const [item] = await queueStore.list();
    expect(server.posts()[0]!.headers.get('Idempotency-Key')).toBe(item!.id);
  });

  it('следующий расход получает новый ключ', async () => {
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person, 'Раз', '100');
    await submit(person);
    await screen.findByText(QUEUED);
    await fillForm(person, 'Два', '200');
    await submit(person);

    await waitFor(async () => expect(await queueStore.list()).toHaveLength(2));
    const keys = (await queueStore.list()).map((item) => item.id);
    expect(new Set(keys).size).toBe(2);
  });

  it('двойное нажатие не создаёт дубликат в очереди', async () => {
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person);
    const button = screen.getByRole('button', { name: 'Добавить расход' });

    await Promise.all([person.click(button), person.click(button)]);
    await screen.findByText(QUEUED);

    expect(await queueStore.list()).toHaveLength(1);
  });

  it('двойное нажатие при сети шлёт один запрос', async () => {
    const { person } = await renderApp();
    await fillForm(person);
    const button = screen.getByRole('button', { name: 'Добавить расход' });

    await Promise.all([person.click(button), person.click(button)]);
    await screen.findByText('Расход успешно добавлен');

    expect(server.posts()).toHaveLength(1);
  });

  it('фото попадает в очередь вместе с расходом', async () => {
    stubImaging();
    server.receiptSettings = { enabled: true, categories: ['кафе'] };
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person);
    await person.upload(
      await screen.findByLabelText('Выбрать фото чека'),
      new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByAltText('Фото чека');

    await submit(person);
    await screen.findByText(QUEUED);

    const [item] = await queueStore.list();
    expect(item!.photo).toBeInstanceOf(Blob);
    expect(item!.photo!.type).toBe('image/jpeg');
    // The photo field is cleared with the form
    expect(screen.queryByAltText('Фото чека')).toBeNull();
  });

  it('IndexedDB недоступен: ошибка «Не удалось сохранить на устройстве», форма не очищена', async () => {
    const { person } = await renderApp();
    setOnLine(false);
    await fillForm(person);
    vi.stubGlobal('indexedDB', undefined);

    await submit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось сохранить на устройстве, попробуйте позже',
    );
    expect(screen.getByLabelText('Наименование')).toHaveValue('Кофе');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('1 000');
  });
});

describe('справочники без сети', () => {
  it('карты, категории и подсказки остаются в форме, пока связь пропала и рефетч не удался', async () => {
    const { person, client } = await renderApp();
    server.network = false;
    setOnLine(false);

    await client.refetchQueries({ queryKey: ['categories'] });
    await client.refetchQueries({ queryKey: ['cards'] });

    expect(screen.getByLabelText('Карта')).toHaveValue('Миша');
    expect(within(screen.getByLabelText('Категория')).getAllByRole('option')).toHaveLength(3);
    // The form still works and saves to the queue
    await fillForm(person);
    await submit(person);
    expect(await screen.findByText(QUEUED)).toBeInTheDocument();
  });

  it('неудавшееся фоновое обновление не прячет форму ошибкой загрузки', async () => {
    const { client } = await renderApp();
    server.network = false;

    await client.refetchQueries({ queryKey: ['config'] });

    expect(screen.queryByText(/Не удалось загрузить данные формы/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeInTheDocument();
  });
});
