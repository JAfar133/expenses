import { randomUUID } from 'node:crypto';
import { validationError } from '../../errors/app-error.ts';
import type { Expense, ExpenseRepository } from '../../storage/expense.repository.ts';
import type { CreateExpenseInput } from './expenses.schema.ts';

export interface ReferenceData {
  cards: string[];
  categories: string[];
}

export interface ExpenseServiceOptions {
  reference: ReferenceData;
  /** Сколько хранить список категорий, прочитанный из Excel */
  categoriesCacheMs?: number;
  logger?: { warn: (object: object, message: string) => void };
  now?: () => number;
}

export type CreatedExpense = Expense & { id: string };

const DEFAULT_CACHE_MS = 5 * 60 * 1000;

export class ExpenseService {
  private categoriesCache?: { value: string[]; expiresAt: number };
  private readonly now: () => number;

  constructor(
    private readonly repository: ExpenseRepository,
    private readonly options: ExpenseServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  getCards(): string[] {
    return this.options.reference.cards;
  }

  /** Категории из конфигурации + уникальные значения из Excel. Неизвестные не заменяем. */
  async getCategories(): Promise<string[]> {
    if (this.categoriesCache && this.categoriesCache.expiresAt > this.now()) {
      return this.categoriesCache.value;
    }

    const configured = this.options.reference.categories;
    const fromStorage = await this.readStoredCategories();
    const value = [...new Set([...configured, ...fromStorage])];

    const ttl = this.options.categoriesCacheMs ?? DEFAULT_CACHE_MS;
    this.categoriesCache = { value, expiresAt: this.now() + ttl };
    return value;
  }

  async create(input: CreateExpenseInput): Promise<CreatedExpense> {
    if (!this.getCards().includes(input.card)) {
      throw validationError('INVALID_CARD', 'Выберите карту из списка');
    }

    const saved = await this.repository.create(input);
    this.categoriesCache = undefined;

    return { id: randomUUID(), ...saved };
  }

  /** Недоступность Excel не должна ломать форму: отдаём категории из конфигурации. */
  private async readStoredCategories(): Promise<string[]> {
    try {
      return await this.repository.listCategories();
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'Failed to read categories from storage');
      return [];
    }
  }
}
