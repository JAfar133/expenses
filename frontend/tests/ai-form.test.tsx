import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import {
  enableAi,
  fillForm,
  renderApp,
  server,
  setOnLine,
  setupOfflineHarness,
  submit,
  allowPhotos,
  pickPhoto,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

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

describe('редактор позиций на узком экране', () => {
  it('каждая позиция — карточка: название на всю строку, во второй строке цена, «Кол.» и крестик; ввод работает', async () => {
    const { person } = await renderApp();
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));

    const name = screen.getByLabelText('Название позиции 1');
    expect(name.parentElement!.className).toContain('w-full');
    expect(name.closest('li')!.className).toContain('flex-wrap');
    expect(screen.getByPlaceholderText('Кол.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить позицию 1' }).className).toContain(
      'ml-auto',
    );
    await person.type(name, 'Молоко 3,2% пастеризованное');
    await person.type(screen.getByLabelText('Цена позиции 1'), '1249,5');
    await person.type(screen.getByLabelText('Количество позиции 1'), '2');

    expect(name).toHaveValue('Молоко 3,2% пастеризованное');
    expect(screen.getByLabelText('Цена позиции 1')).toHaveValue('1 249,5');
    expect(screen.getByLabelText('Количество позиции 1')).toHaveValue('2');
  });

  it('кнопка добавления — текстовая «Добавить позицию»', async () => {
    const { person } = await renderApp();
    await person.click(screen.getByRole('button', { name: '+ Позиции чека' }));

    const add = screen.getByRole('button', { name: 'Добавить позицию' });
    expect(add).toHaveTextContent('Добавить позицию');
    await person.click(add);

    expect(screen.getByLabelText('Название позиции 2')).toBeInTheDocument();
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

  it('без фото разбор не запускается', async () => {
    enableAi();
    const { person } = await renderApp();
    await fillForm(person);

    await submit(person);

    await screen.findByText('Расход успешно добавлен');
    expect(server.parses()).toHaveLength(0);
  });
});

describe('ИИ и очередь без сети', () => {
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
