import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';
import { todayIso } from '../src/shared/utils/date.ts';

type Responder = (body: Record<string, unknown>, headers: Headers) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const created = (body: Record<string, unknown>, excelStatus = 'synced') =>
  json(201, {
    success: true,
    data: { id: '1', excelStatus, ...body },
    message: 'Расход успешно добавлен',
  });

let postExpense: ReturnType<typeof vi.fn<Responder>>;

beforeEach(() => {
  postExpense = vi.fn<Responder>((body) => created(body));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/cards') return json(200, { success: true, data: ['Миша', 'Настя'] });
      if (url === '/api/categories')
        return json(200, { success: true, data: ['кафе', 'продукты'] });
      if (url === '/api/sync/status') {
        return json(200, {
          success: true,
          data: {
            queued: 0,
            running: false,
            intervalMs: 300000,
            nextRunAt: null,
            serverTime: new Date().toISOString(),
          },
        });
      }
      if (url === '/api/config') return json(200, { success: true, data: { currency: 'AMD' } });
      if (url === '/api/expenses') {
        return postExpense(JSON.parse(String(init?.body)), new Headers(init?.headers));
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddExpensePage />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Добавить расход' });
  return userEvent.setup();
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Категория'), 'продукты');
  await user.type(screen.getByLabelText('Наименование'), 'Erevan City');
  await user.type(screen.getByLabelText('Стоимость'), '9703');
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Добавить расход' }));

describe('отображение формы', () => {
  it('показывает пять полей, по умолчанию сегодняшнюю дату и валюту', async () => {
    await renderPage();

    expect(screen.getByLabelText('Дата')).toHaveValue(todayIso());
    expect(screen.getByRole('radio', { name: /Миша/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Настя/ })).not.toBeChecked();
    expect(screen.getByLabelText('Категория')).toHaveValue('');
    expect(screen.getByLabelText('Наименование')).toBeInTheDocument();
    expect(screen.getByLabelText('Стоимость')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByText('AMD')).toBeInTheDocument();
  });

  it('предлагает повторить, если справочники не загрузились', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, { success: false, error: { code: 'X', message: 'x' } })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <AddExpensePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('валидация', () => {
  it('не отправляет пустую форму и показывает ошибки', async () => {
    const user = await renderPage();

    await submit(user);

    expect(await screen.findByText('Выберите категорию')).toBeInTheDocument();
    expect(screen.getByText('Введите наименование')).toBeInTheDocument();
    expect(screen.getByText('Введите стоимость')).toBeInTheDocument();
    expect(postExpense).not.toHaveBeenCalled();
  });

  it('не принимает нулевую стоимость', async () => {
    const user = await renderPage();
    await fillForm(user);
    await user.clear(screen.getByLabelText('Стоимость'));
    await user.type(screen.getByLabelText('Стоимость'), '0');

    await submit(user);

    expect(await screen.findByText('Стоимость должна быть больше нуля')).toBeInTheDocument();
    expect(postExpense).not.toHaveBeenCalled();
  });

  it('не принимает наименование из одних пробелов', async () => {
    const user = await renderPage();
    await fillForm(user);
    await user.clear(screen.getByLabelText('Наименование'));
    await user.type(screen.getByLabelText('Наименование'), '   ');

    await submit(user);

    expect(await screen.findByText('Введите наименование')).toBeInTheDocument();
  });

  it('форматирует стоимость с пробелами при вводе', async () => {
    const user = await renderPage();

    await user.type(screen.getByLabelText('Стоимость'), '25890');

    expect(screen.getByLabelText('Стоимость')).toHaveValue('25 890');
  });
});

describe('отправка', () => {
  it('отправляет число и Idempotency-Key, очищает наименование и стоимость', async () => {
    const user = await renderPage();
    await fillForm(user);
    await user.clear(screen.getByLabelText('Стоимость'));
    await user.type(screen.getByLabelText('Стоимость'), '25890');

    await submit(user);

    expect(await screen.findByText('Расход успешно добавлен')).toBeInTheDocument();
    expect(postExpense).toHaveBeenCalledWith(
      { date: todayIso(), card: 'Миша', category: 'продукты', name: 'Erevan City', amount: 25890 },
      expect.objectContaining({}),
    );
    expect(postExpense.mock.calls[0]![1].get('Idempotency-Key')).toBeTruthy();

    expect(screen.getByLabelText('Наименование')).toHaveValue('');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('');
    expect(screen.getByLabelText('Категория')).toHaveValue('продукты');
    expect(screen.getByLabelText('Дата')).toHaveValue(todayIso());
  });

  it('запоминает последнюю карту и категорию', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('radio', { name: /Настя/ }));
    await fillForm(user);

    await submit(user);
    await screen.findByText('Расход успешно добавлен');

    expect(localStorage.getItem('expenses.lastCard')).toBe('Настя');
    expect(localStorage.getItem('expenses.lastCategory')).toBe('продукты');
  });

  it('блокирует кнопку на время запроса, двойное нажатие даёт один запрос', async () => {
    let release!: () => void;
    postExpense.mockImplementation(
      (body) => new Promise((resolve) => (release = () => resolve(created(body)))),
    );
    const user = await renderPage();
    await fillForm(user);

    await submit(user);
    const button = await screen.findByRole('button', { name: 'Сохраняем…' });
    await user.click(button);
    await user.click(button);

    expect(button).toBeDisabled();
    expect(postExpense).toHaveBeenCalledTimes(1);

    release();
    await screen.findByText('Расход успешно добавлен');
  });

  it('повторная отправка после ошибки использует тот же Idempotency-Key', async () => {
    postExpense.mockImplementationOnce(() =>
      json(503, {
        success: false,
        error: { code: 'STORAGE_UNAVAILABLE', message: 'OneDrive недоступен. Попробуйте позже' },
      }),
    );
    const user = await renderPage();
    await fillForm(user);

    await submit(user);
    await screen.findByText('OneDrive недоступен. Попробуйте позже');
    await submit(user);
    await screen.findByText('Расход успешно добавлен');

    const keys = postExpense.mock.calls.map(([, headers]) => headers.get('Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]);
  });

  it('если Excel недоступен, сообщает, что расход сохранён и ждёт в очереди', async () => {
    postExpense.mockImplementation((body) => created(body, 'queued'));
    const user = await renderPage();
    await fillForm(user);

    await submit(user);

    expect(await screen.findByText(/появится позже/)).toBeInTheDocument();
    expect(screen.queryByText('Расход успешно добавлен')).not.toBeInTheDocument();
    // Расход сохранён, поэтому форма очищается так же, как при обычном успехе
    expect(screen.getByLabelText('Наименование')).toHaveValue('');
  });

  it('после успеха следующий расход получает новый Idempotency-Key', async () => {
    const user = await renderPage();
    await fillForm(user);
    await submit(user);
    await screen.findByText('Расход успешно добавлен');

    await user.type(screen.getByLabelText('Наименование'), 'Кофе');
    await user.type(screen.getByLabelText('Стоимость'), '640');
    await submit(user);
    await waitFor(() => expect(postExpense).toHaveBeenCalledTimes(2));

    const keys = postExpense.mock.calls.map(([, headers]) => headers.get('Idempotency-Key'));
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('ошибки', () => {
  it('показывает сообщение о конфликте от сервера', async () => {
    postExpense.mockImplementation(() =>
      json(409, {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Таблица была изменена. Расход не добавлен. Повторите попытку',
        },
      }),
    );
    const user = await renderPage();
    await fillForm(user);

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Таблица была изменена. Расход не добавлен. Повторите попытку',
    );
    // Введённые данные не теряются
    expect(screen.getByLabelText('Наименование')).toHaveValue('Erevan City');
  });

  it('просит проверить запись, если ответ не получен', async () => {
    postExpense.mockImplementation(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = await renderPage();
    await fillForm(user);

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте, добавился ли расход');
  });

  it('показывает общее сообщение при внутренней ошибке', async () => {
    postExpense.mockImplementation(() =>
      json(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'подробности' } }),
    );
    const user = await renderPage();
    await fillForm(user);

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось сохранить расход. Попробуйте позже',
    );
  });
});
