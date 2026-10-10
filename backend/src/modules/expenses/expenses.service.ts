import type { SqlExecutor } from '../../infrastructure/database/database.ts';
import { validationError } from '../../errors/app-error.ts';
import type { ExpenseRepository, StoredExpense } from '../../storage/expense.repository.ts';
import type { CreateExpenseInput } from './expenses.schema.ts';

export interface ReferenceData {
  cards: string[];
  categories: string[];
}

export interface ExpenseServiceOptions {
  reference: ReferenceData;
  logger?: { warn: (object: object, message: string) => void };
}

export class ExpenseService {
  constructor(
    private readonly repository: ExpenseRepository,
    private readonly options: ExpenseServiceOptions,
  ) {}

  getCards(): string[] {
    return this.options.reference.cards;
  }

  /** Категории из конфигурации + уникальные значения из БД (в том числе из Excel). */
  async getCategories(): Promise<string[]> {
    const configured = this.options.reference.categories;
    const stored = await this.readStoredCategories();
    return [...new Set([...configured, ...stored])];
  }

  /** Сохраняет расход в БД. В Excel он попадёт через очередь синхронизации. */
  async create(db: SqlExecutor, input: CreateExpenseInput, userId: string): Promise<StoredExpense> {
    if (!this.getCards().includes(input.card)) {
      throw validationError('INVALID_CARD', 'Выберите карту из списка');
    }
    return this.repository.insertPending(db, input, userId);
  }

  findById(id: string): Promise<StoredExpense | undefined> {
    return this.repository.findById(id);
  }

  /** Недоступность БД не должна ломать форму: отдаём категории из конфигурации. */
  private async readStoredCategories(): Promise<string[]> {
    try {
      return await this.repository.listCategories();
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'Failed to read categories from database');
      return [];
    }
  }
}
