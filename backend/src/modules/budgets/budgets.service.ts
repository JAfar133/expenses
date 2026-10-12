import { AppError, notFoundError, validationError } from '../../errors/app-error.ts';
import type { AnalyticsRepository } from '../analytics/analytics.repository.ts';
import { todayIn } from '../analytics/date-math.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import { scopeOf } from '../groups/scope.ts';
import { BudgetExistsError, type BudgetRow, type BudgetsRepository } from './budgets.repository.ts';
import { periodOf, type BudgetPeriod, type BudgetPeriodKind } from './period.ts';

const MAX_LIMIT = 1_000_000_000;
const PERIOD_KINDS: BudgetPeriodKind[] = ['month', 'month_from_day', 'week'];

export type BudgetLevel = 'ok' | 'warn' | 'over';

/** A limit with how much of it is spent in the current period. */
export interface BudgetProgress extends BudgetRow {
  period: BudgetPeriod;
  /** Spent in the period in the reporting currency (by the cards the user may see) */
  spent: number;
  remaining: number;
  /** Share of the limit that is spent, in percent (may be above 100) */
  percent: number;
  /** ok below 80%, warn from 80%, over from 100% */
  level: BudgetLevel;
}

export interface BudgetsServiceOptions {
  repository: Pick<BudgetsRepository, 'list' | 'categoryInGroup' | 'create' | 'update' | 'remove'>;
  analytics: Pick<AnalyticsRepository, 'summary'>;
  /** The clock (tests) */
  now?: () => Date;
}

const levelOf = (percent: number): BudgetLevel =>
  percent >= 100 ? 'over' : percent >= 80 ? 'warn' : 'ok';

/** Spending limits: everyone in the group sees the progress, only the owner changes the limits. */
export class BudgetsService {
  constructor(private readonly options: BudgetsServiceOptions) {}

  /** The limits of the user's group with the spending of the current period (in the user's time zone). */
  async progress(user: AuthUser): Promise<BudgetProgress[]> {
    if (!user.groupId) return [];
    const budgets = await this.options.repository.list(user.groupId);
    const today = todayIn(user.timezone, (this.options.now ?? (() => new Date()))());

    return Promise.all(
      budgets.map(async (budget) => {
        const period = periodOf(budget.periodKind, budget.periodDay, today);
        const { total } = await this.options.analytics.summary({
          from: period.from,
          to: period.to,
          cards: [],
          categories: budget.category ? [budget.category] : [],
          createdBy: [],
          currencies: [],
          includeDeleted: false,
          scope: scopeOf(user),
        });
        const percent = (total / budget.limit) * 100;
        return {
          ...budget,
          period,
          spent: total,
          remaining: budget.limit - total,
          percent,
          level: levelOf(percent),
        };
      }),
    );
  }

  async create(owner: AuthUser, input: unknown): Promise<string> {
    const groupId = this.groupOf(owner);
    const body = (input ?? {}) as Record<string, unknown>;
    const categoryId =
      body.categoryId === undefined || body.categoryId === null ? null : String(body.categoryId);
    if (categoryId && !(await this.options.repository.categoryInGroup(groupId, categoryId))) {
      throw validationError('INVALID_CATEGORY', 'Выберите категорию из списка');
    }
    try {
      return await this.options.repository.create(groupId, { categoryId, ...this.parse(body) });
    } catch (error) {
      if (error instanceof BudgetExistsError) {
        throw new AppError(409, 'BUDGET_EXISTS', 'Лимит для этой категории уже есть: измените его');
      }
      throw error;
    }
  }

  async update(owner: AuthUser, id: string, input: unknown): Promise<void> {
    const found = await this.options.repository.update(
      this.groupOf(owner),
      id,
      this.parse((input ?? {}) as Record<string, unknown>),
    );
    if (!found) throw notFoundError();
  }

  async remove(owner: AuthUser, id: string): Promise<void> {
    if (!(await this.options.repository.remove(this.groupOf(owner), id))) throw notFoundError();
  }

  private groupOf(owner: AuthUser): string {
    if (!owner.groupId) throw notFoundError();
    return owner.groupId;
  }

  /** The limit and the period from a request body. */
  private parse(body: Record<string, unknown>) {
    const limit = Number(body.limit);
    if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_LIMIT) {
      throw validationError('INVALID_LIMIT', 'Лимит должен быть больше нуля');
    }
    if (
      Math.round(limit * 100) !== limit * 100 &&
      Math.abs(limit * 100 - Math.round(limit * 100)) > 1e-6
    ) {
      throw validationError('INVALID_LIMIT', 'Лимит: не более двух знаков после запятой');
    }
    const periodKind = body.periodKind as BudgetPeriodKind;
    if (!PERIOD_KINDS.includes(periodKind)) {
      throw validationError('INVALID_PERIOD', 'Выберите период: месяц, месяц с числа или неделя');
    }
    let periodDay: number | null = null;
    if (periodKind === 'month_from_day') {
      periodDay = Number(body.periodDay);
      if (!Number.isInteger(periodDay) || periodDay < 1 || periodDay > 28) {
        throw validationError('INVALID_PERIOD', 'Число начала месяца: от 1 до 28');
      }
    }
    return { limit: Math.round(limit * 100) / 100, periodKind, periodDay };
  }
}
