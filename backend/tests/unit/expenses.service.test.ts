import { describe, expect, it, vi } from 'vitest';
import { ExpenseService } from '../../src/modules/expenses/expenses.service.ts';
import type { Expense, ExpenseRepository } from '../../src/storage/expense.repository.ts';

const input: Expense = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Erevan City',
  amount: 9703,
};

function createRepository(storedCategories: string[] = []) {
  return {
    create: vi.fn(async (expense: Expense) => expense),
    listCategories: vi.fn(async () => storedCategories),
  } satisfies ExpenseRepository;
}

function createService(repository: ExpenseRepository, now = () => 0) {
  return new ExpenseService(repository, {
    reference: { cards: ['Миша', 'Настя'], categories: ['кафе', 'продукты'] },
    categoriesCacheMs: 1000,
    now,
  });
}

describe('create', () => {
  it('сохраняет операцию и присваивает id', async () => {
    const repository = createRepository();

    const created = await createService(repository).create(input);

    expect(repository.create).toHaveBeenCalledWith(input);
    expect(created).toMatchObject(input);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('отклоняет карту, которой нет в справочнике', async () => {
    const repository = createRepository();

    await expect(
      createService(repository).create({ ...input, card: 'Вася' }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_CARD',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('принимает неизвестную категорию как есть', async () => {
    const repository = createRepository();

    await createService(repository).create({ ...input, category: 'путешествия' });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'путешествия' }),
    );
  });
});

describe('getCategories', () => {
  it('объединяет конфигурацию и значения из хранилища без дублей', async () => {
    const service = createService(createRepository(['продукты', 'путешествия']));

    expect(await service.getCategories()).toEqual(['кафе', 'продукты', 'путешествия']);
  });

  it('кеширует результат, пока не истёк срок', async () => {
    const repository = createRepository();
    let time = 0;
    const service = createService(repository, () => time);

    await service.getCategories();
    await service.getCategories();
    expect(repository.listCategories).toHaveBeenCalledTimes(1);

    time = 1001;
    await service.getCategories();
    expect(repository.listCategories).toHaveBeenCalledTimes(2);
  });

  it('сбрасывает кеш после создания расхода', async () => {
    const repository = createRepository();
    const service = createService(repository);

    await service.getCategories();
    await service.create(input);
    await service.getCategories();

    expect(repository.listCategories).toHaveBeenCalledTimes(2);
  });

  it('отдаёт категории из конфигурации, если хранилище недоступно', async () => {
    const repository = createRepository();
    repository.listCategories.mockRejectedValue(new Error('OneDrive down'));

    expect(await createService(repository).getCategories()).toEqual(['кафе', 'продукты']);
  });
});
