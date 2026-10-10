import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { storageUnavailableError, writeStatusUnknownError } from '../../src/errors/app-error.ts';
import { ExpenseService } from '../../src/modules/expenses/expenses.service.ts';
import type { Expense, ExpenseRepository } from '../../src/storage/expense.repository.ts';

const validBody = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Erevan City',
  amount: 9703,
};

let repository: { create: ReturnType<typeof vi.fn>; listCategories: ReturnType<typeof vi.fn> };

function createApp() {
  const expenseService = new ExpenseService(repository as ExpenseRepository, {
    reference: { cards: ['Миша', 'Настя'], categories: ['кафе', 'продукты'] },
  });
  return buildApp({ expenseService });
}

const post = (body: unknown) =>
  createApp().inject({ method: 'POST', url: '/api/expenses', payload: body as object });

beforeEach(() => {
  repository = {
    create: vi.fn(async (expense: Expense) => expense),
    listCategories: vi.fn(async () => ['путешествия']),
  };
});

describe('POST /api/expenses', () => {
  it('создаёт расход и возвращает 201', async () => {
    const response = await post(validBody);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      data: validBody,
      message: 'Расход успешно добавлен',
    });
  });

  it('обрезает пробелы в наименовании', async () => {
    await post({ ...validBody, name: '  Кофе  ' });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Кофе' }));
  });

  it.each([
    [{ ...validBody, amount: 0 }, 'INVALID_AMOUNT', 'Стоимость должна быть больше нуля'],
    [{ ...validBody, amount: -5 }, 'INVALID_AMOUNT', 'Стоимость должна быть больше нуля'],
    [{ ...validBody, amount: 10.5 }, 'INVALID_AMOUNT', 'Стоимость должна быть целым числом'],
    [{ ...validBody, amount: '100' }, 'INVALID_AMOUNT', 'Стоимость должна быть числом'],
    [{ ...validBody, date: '2026-02-30' }, 'INVALID_DATE', 'Укажите корректную дату'],
    [{ ...validBody, name: '   ' }, 'INVALID_NAME', 'Введите наименование'],
    [{ ...validBody, name: 'x'.repeat(256) }, 'INVALID_NAME', expect.any(String)],
    [{ ...validBody, category: '' }, 'INVALID_CATEGORY', 'Выберите категорию'],
    [{ ...validBody, card: 'Вася' }, 'INVALID_CARD', 'Выберите карту из списка'],
  ])('возвращает 422 на некорректные данные %#', async (body, code, message) => {
    const response = await post(body);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ success: false, error: { code, message } });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('возвращает 400 на битый JSON', async () => {
    const response = await createApp().inject({
      method: 'POST',
      url: '/api/expenses',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('возвращает 503, если OneDrive недоступен', async () => {
    repository.create.mockRejectedValue(storageUnavailableError());

    const response = await post(validBody);

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('возвращает WRITE_STATUS_UNKNOWN, если результат записи неизвестен', async () => {
    repository.create.mockRejectedValue(writeStatusUnknownError());

    const response = await post(validBody);

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('WRITE_STATUS_UNKNOWN');
  });

  it('не раскрывает детали непредвиденных ошибок', async () => {
    repository.create.mockRejectedValue(new Error('secret internal detail'));

    const response = await post(validBody);

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret');
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
  });
});

describe('справочники и health', () => {
  it('GET /api/cards', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/cards' });

    expect(response.json()).toEqual({ success: true, data: ['Миша', 'Настя'] });
  });

  it('GET /api/categories объединяет конфигурацию и Excel', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/categories' });

    expect(response.json()).toEqual({ success: true, data: ['кафе', 'продукты', 'путешествия'] });
  });

  it('GET /api/health не обращается к хранилищу', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toEqual({ status: 'ok' });
    expect(repository.listCategories).not.toHaveBeenCalled();
  });
});
