import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import { draftToFormValues } from '../src/features/offline-queue/model/draft.ts';
import { failure, renderApp, server, setupOfflineHarness } from './helpers/offline-harness.tsx';
import { queued } from './helpers/queue-fixtures.ts';

setupOfflineHarness();

/** The server is down for the whole test: records stay in the queue, nothing disappears by itself. */
const keepInQueue = () => {
  server.postExpense = () => failure(503, 'Сервер недоступен');
};
const block = () => screen.getByRole('region', { name: 'Не отправлено' });
const open = async (person: Awaited<ReturnType<typeof renderApp>>['person'], count: number) =>
  person.click(await screen.findByRole('button', { name: `Не отправлено: ${count}` }));

describe('блок «Не отправлено»', () => {
  it('пустая очередь: блока нет', async () => {
    await renderApp();

    expect(screen.queryByRole('region', { name: 'Не отправлено' })).toBeNull();
  });

  it('показывает счётчик и свёрнут по умолчанию', async () => {
    keepInQueue();
    await queueStore.add(queued('1'));
    await queueStore.add(queued('2'));
    await renderApp();

    const toggle = await screen.findByRole('button', { name: 'Не отправлено: 2' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(block()).queryByRole('list')).toBeNull();
  });

  it('раскрывается: дата, наименование, сумма с валютой, карта и статус «ждёт сети»', async () => {
    keepInQueue();
    await queueStore.add(
      queued('1', {
        expense: {
          date: '2026-10-14',
          card: 'Настя',
          category: 'кафе',
          name: 'Латте',
          amount: 12.5,
          currency: 'USD',
          rate: 380,
        },
      }),
    );
    const { person } = await renderApp();

    await open(person, 1);

    const row = within(block()).getByRole('listitem');
    expect(row).toHaveTextContent('Латте');
    expect(row).toHaveTextContent('12,50 USD');
    expect(row).toHaveTextContent('2026-10-14');
    expect(row).toHaveTextContent('Настя');
    expect(row).toHaveTextContent('ждёт сети');
    expect(screen.getByRole('button', { name: /Не отправлено: 1/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('статус «отправляется», пока запись уходит', async () => {
    server.postExpense = () => new Promise<Response>(() => undefined);
    await queueStore.add(queued('1'));
    const { person } = await renderApp();

    await open(person, 1);

    expect(await within(block()).findByText(/отправляется/)).toBeInTheDocument();
  });

  it('failed: «нужно исправить: <ошибка>» и кнопка «Повторить», у pending её нет', async () => {
    keepInQueue();
    await queueStore.add(queued('1', { status: 'failed', error: 'Такой карты нет' }));
    await queueStore.add(queued('2'));
    const { person } = await renderApp();

    await open(person, 2);

    const [failed, pending] = within(block()).getAllByRole('listitem');
    expect(failed).toHaveTextContent('нужно исправить: Такой карты нет');
    expect(within(failed!).getByRole('button', { name: 'Повторить' })).toHaveAttribute(
      'title',
      'Повторить',
    );
    expect(within(pending!).queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('кнопки действий — иконки с aria-label и title', async () => {
    keepInQueue();
    await queueStore.add(queued('1'));
    const { person } = await renderApp();

    await open(person, 1);

    for (const name of ['Изменить', 'Удалить']) {
      expect(within(block()).getByRole('button', { name })).toHaveAttribute('title', name);
    }
  });

  it('«Удалить» просит подтверждение; «Отмена» оставляет запись', async () => {
    keepInQueue();
    await queueStore.add(queued('1'));
    const { person } = await renderApp();
    await open(person, 1);

    await person.click(within(block()).getByRole('button', { name: 'Удалить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить расход?' });
    await person.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await queueStore.list()).toHaveLength(1);
  });

  it('подтверждённое удаление убирает запись и блок', async () => {
    keepInQueue();
    await queueStore.add(queued('1'));
    const { person } = await renderApp();
    await open(person, 1);

    await person.click(within(block()).getByRole('button', { name: 'Удалить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить расход?' });
    await person.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Не отправлено' })).toBeNull());
    expect(await queueStore.list()).toEqual([]);
  });

  it('«Повторить» возвращает failed в очередь и сразу отправляет; потом «Все расходы отправлены»', async () => {
    keepInQueue();
    await queueStore.add(queued('1', { status: 'failed', error: 'Временная ошибка' }));
    const { person } = await renderApp();
    await open(person, 1);
    expect(server.posts()).toHaveLength(0);
    server.postExpense = () =>
      new Response(JSON.stringify({ success: true, data: { id: 's' } }), { status: 201 });

    await person.click(within(block()).getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(server.posts()).toHaveLength(1));
    expect(await screen.findByText('Все расходы отправлены')).toBeInTheDocument();
    expect(await queueStore.list()).toEqual([]);
  });

  it('«Изменить» убирает запись из очереди и подставляет значения в форму', async () => {
    keepInQueue();
    await queueStore.add(
      queued('1', {
        expense: {
          date: '2026-10-10',
          card: 'Настя',
          category: 'продукты',
          name: 'Хлеб',
          amount: 25890,
        },
      }),
    );
    const { person } = await renderApp();
    await open(person, 1);

    await person.click(within(block()).getByRole('button', { name: 'Изменить' }));

    await waitFor(() => expect(screen.getByLabelText('Наименование')).toHaveValue('Хлеб'));
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-10-10');
    expect(screen.getByLabelText('Карта')).toHaveValue('Настя');
    expect(screen.getByLabelText('Категория')).toHaveValue('продукты');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('25 890');
    expect(await queueStore.list()).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Не отправлено' })).toBeNull();
  });

  it('исправленный расход отправляется как новая операция с новым ключом', async () => {
    keepInQueue();
    await queueStore.add(queued('old-key'));
    const { person } = await renderApp();
    await open(person, 1);
    await person.click(within(block()).getByRole('button', { name: 'Изменить' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Наименование')).toHaveValue('Расход old-key'),
    );
    server.postExpense = () =>
      new Response(
        JSON.stringify({ success: true, data: { id: 's', excelStatus: 'synced', original: null } }),
        { status: 201 },
      );

    await person.click(screen.getByRole('button', { name: 'Добавить расход' }));

    await screen.findByText('Расход успешно добавлен');
    const keys = server.posts().map((request) => request.headers.get('Idempotency-Key'));
    expect(keys.at(-1)).not.toBe('old-key');
  });
});

describe('значения формы из записи очереди', () => {
  const base = { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе' };

  it('валюта карты и драммы: целая сумма с пробелами, без курса', () => {
    expect(
      draftToFormValues(queued('1', { expense: { ...base, amount: 25890 } }), 'AMD', 'AMD'),
    ).toEqual({ ...base, currency: 'AMD', amount: '25 890', rate: '' });
  });

  it('драммы: дробная сумма попадает в форму с запятой', () => {
    expect(
      draftToFormValues(queued('1', { expense: { ...base, amount: 1234.5 } }), 'AMD', 'AMD'),
    ).toMatchObject({ currency: 'AMD', amount: '1 234,5' });
  });

  it('другая валюта: сумма с запятой и курс', () => {
    expect(
      draftToFormValues(
        queued('1', { expense: { ...base, amount: 12.5, currency: 'USD', rate: 380.5 } }),
        'AMD',
        'AMD',
      ),
    ).toMatchObject({ currency: 'USD', amount: '12,5', rate: '380,5' });
  });

  it('валюта не указана: берётся валюта карты', () => {
    expect(
      draftToFormValues(queued('1', { expense: { ...base, amount: 10.25 } }), 'AMD', 'USD'),
    ).toMatchObject({ currency: 'USD', amount: '10,25' });
  });
});
