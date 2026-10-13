import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  allowPhotos,
  enableAi,
  failure,
  ok,
  renderApp,
  server,
  setupOfflineHarness,
  stubImaging,
  submit,
  type Person,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

const AI = 'Сгенерировано с помощью AI';
const GOOGLE = 'Чек будет отправлен на разбор в Google (Gemini)';

async function ready({ confirmed = true } = {}) {
  enableAi();
  allowPhotos();
  server.receiptSettings = {
    enabled: true,
    categories: ['кафе', 'продукты'],
    aiCategories: ['кафе', 'продукты'],
  };
  if (confirmed) server.preferences = { 'ai.noticeSeen': true };
  return renderApp();
}

/** A photo without any category chosen. */
async function upload(person: Person) {
  await person.upload(
    await screen.findByLabelText('Выбрать фото чека'),
    new File(['img'], 'check.jpg', { type: 'image/jpeg' }),
  );
  await screen.findByAltText('Фото чека');
}

const answer =
  (patch: Record<string, unknown> = {}) =>
  () =>
    ok({
      parseId: 'p1',
      category: 'продукты',
      name: 'Магазин',
      date: null,
      items: [],
      total: null,
      currency: null,
      dropped: 0,
      ...patch,
    });

const categoryLabel = () => screen.getByText('Категория', { selector: 'label' });

describe('чек без выбранной категории', () => {
  it('ИИ доступен: блок фото виден до выбора категории, с подсказкой', async () => {
    await ready();

    expect(await screen.findByRole('button', { name: 'Прикрепить фото чека' })).toBeInTheDocument();
    expect(screen.getByText('ИИ сам заполнит данные, включая категорию')).toBeInTheDocument();
  });

  it('ИИ недоступен: фото только после выбора категории, подсказки нет', async () => {
    allowPhotos();
    const { person } = await renderApp();

    expect(screen.queryByRole('button', { name: 'Прикрепить фото чека' })).toBeNull();
    expect(screen.queryByText(/включая категорию/)).toBeNull();
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    expect(await screen.findByRole('button', { name: 'Прикрепить фото чека' })).toBeInTheDocument();
  });

  it('ни одной категории с фото и ИИ: блока нет', async () => {
    enableAi();
    server.receiptSettings = { enabled: true, categories: ['кафе'], aiCategories: ['продукты'] };
    await renderApp();

    expect(screen.queryByRole('button', { name: 'Прикрепить фото чека' })).toBeNull();
  });

  it('подсказка пропадает, когда категория выбрана', async () => {
    const { person } = await ready();

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');

    expect(screen.queryByText('ИИ сам заполнит данные, включая категорию')).toBeNull();
  });

  it('плашка про Google до отправки; затем запрос разбора без ?category=', async () => {
    server.parsePhoto = answer();
    const { person } = await ready({ confirmed: false });

    await upload(person);
    expect(await screen.findByText(GOOGLE)).toBeInTheDocument();
    expect(server.photoParses()).toHaveLength(0);
    await person.click(screen.getByRole('button', { name: 'Понятно' }));

    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(server.photoParses()[0]!.url).toBe('/api/ai/receipt/parse');
  });

  it('категория из ответа подставляется с пометкой AI; ручная смена её снимает', async () => {
    server.parsePhoto = answer();
    const { person } = await ready();

    await upload(person);

    await waitFor(() => expect(screen.getByLabelText('Категория')).toHaveValue('продукты'));
    expect(screen.getByDisplayValue('Магазин')).toBeInTheDocument();
    expect(within(categoryLabel()).getByRole('img', { name: AI })).toBeInTheDocument();

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');

    expect(within(categoryLabel()).queryByRole('img', { name: AI })).toBeNull();
    // The result stays; no second reading
    expect(screen.getByDisplayValue('Магазин')).toBeInTheDocument();
    expect(server.photoParses()).toHaveLength(1);
  });

  it('category null: пусто и мягкая строка «Категорию выберите сами»', async () => {
    server.parsePhoto = answer({ category: null });
    const { person } = await ready();

    await upload(person);

    expect(await screen.findByText('Категорию выберите сами')).toBeInTheDocument();
    expect(screen.getByLabelText('Категория')).toHaveValue('');
    expect(within(categoryLabel()).queryByRole('img', { name: AI })).toBeNull();
  });

  it('категорию выбрали во время разбора: ответ её не меняет', async () => {
    let finish: (response: Response) => void = () => undefined;
    server.parsePhoto = () => new Promise<Response>((resolve) => (finish = resolve));
    const { person } = await ready();
    await upload(person);
    await screen.findByText('Распознаём чек…');

    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    finish(
      ok({
        parseId: 'p1',
        category: 'продукты',
        name: 'Магазин',
        date: null,
        items: [],
        total: null,
        currency: null,
        dropped: 0,
      }),
    );

    expect(await screen.findByDisplayValue('Магазин')).toBeInTheDocument();
    expect(screen.getByLabelText('Категория')).toHaveValue('кафе');
    expect(within(categoryLabel()).queryByRole('img', { name: AI })).toBeNull();
  });

  it('выбрана категория, где фото выключено: фото снимается с предупреждением, aiParseId не уходит', async () => {
    server.parsePhoto = answer({ category: null });
    enableAi();
    stubImaging();
    // The photo is on only in «кафе»
    server.receiptSettings = { enabled: true, categories: ['кафе'], aiCategories: ['кафе'] };
    server.preferences = { 'ai.noticeSeen': true };
    const { person } = await renderApp();
    await upload(person);
    await screen.findByText('Категорию выберите сами');

    await person.selectOptions(screen.getByLabelText('Категория'), 'продукты');

    expect(
      await screen.findByText('В этой категории фото чека не включено, фото убрано'),
    ).toBeInTheDocument();
    expect(screen.queryByAltText('Фото чека')).toBeNull();
    await person.type(screen.getByLabelText('Стоимость'), '500');
    await submit(person);
    await screen.findByText('Расход успешно добавлен');
    expect(server.posts().at(-1)!.body).not.toHaveProperty('aiParseId');
    expect(server.puts()).toHaveLength(0);
  });

  it('сохранение: категория обязательна, aiParseId уходит', async () => {
    server.parsePhoto = answer({ category: null });
    const { person } = await ready();
    await upload(person);
    await screen.findByText('Категорию выберите сами');
    await person.type(screen.getByLabelText('Стоимость'), '500');

    await submit(person);
    expect(await screen.findByText('Выберите категорию')).toBeInTheDocument();
    expect(server.posts()).toHaveLength(0);
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(server.posts().at(-1)!.body).toMatchObject({ category: 'кафе', aiParseId: 'p1' });
  });

  it('AI_CATEGORY_OFF: мягкая карточка с текстом сервера', async () => {
    server.parsePhoto = () =>
      failure(
        409,
        'Для этой категории разбор чеков с помощью ИИ выключен владельцем группы',
        'AI_CATEGORY_OFF',
      );
    const { person } = await ready();

    await upload(person);

    expect(await screen.findByText('Не удалось распознать чек')).toBeInTheDocument();
    expect(screen.getByText(/выключен владельцем группы/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
