import type { SqlExecutor } from '../../infrastructure/database/database.ts';
import { validationError } from '../../errors/app-error.ts';
import type {
  ExpenseRepository,
  NameSuggestion,
  StoredExpense,
} from '../../storage/expense.repository.ts';
import { resolveAmount, type AmountContext } from './expense-amount.ts';
import type { CreateExpenseInput } from './expenses.schema.ts';

/** How many "category + name" pairs we give the form for suggestions. */
const NAME_SUGGESTIONS_LIMIT = 500;

export interface ReferenceData {
  cards: string[];
  categories: string[];
}

export interface ExpenseServiceOptions {
  reference: ReferenceData;
  /** Base currency, available currencies and rates for conversion to drams */
  currency: AmountContext;
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

  /** Categories from the configuration + unique values from the DB (including those from Excel). */
  async getCategories(): Promise<string[]> {
    const configured = this.options.reference.categories;
    const stored = await this.readStoredCategories();
    return [...new Set([...configured, ...stored])];
  }

  /** Name suggestions: from most to least frequent. An unavailable DB does not break the form. */
  async getNameSuggestions(limit = NAME_SUGGESTIONS_LIMIT): Promise<NameSuggestion[]> {
    try {
      return await this.repository.listNameSuggestions(limit);
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'Failed to read name suggestions from database');
      return [];
    }
  }

  /** Saves the expense to the DB. It reaches Excel through the sync queue. */
  async create(db: SqlExecutor, input: CreateExpenseInput, userId: string): Promise<StoredExpense> {
    if (!this.getCards().includes(input.card)) {
      throw validationError('INVALID_CARD', 'Выберите карту из списка');
    }
    const { amount, original } = await resolveAmount(
      {
        amount: input.amount,
        currency: input.currency ?? this.options.currency.base,
        manualRate: input.rate,
      },
      this.options.currency,
    );
    const { date, card, category, name } = input;
    return this.repository.insertPending(
      db,
      { date, card, category, name, amount },
      userId,
      original,
    );
  }

  findById(id: string): Promise<StoredExpense | undefined> {
    return this.repository.findById(id);
  }

  /** DB unavailability must not break the form: return the categories from the configuration. */
  private async readStoredCategories(): Promise<string[]> {
    try {
      return await this.repository.listCategories();
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'Failed to read categories from database');
      return [];
    }
  }
}
