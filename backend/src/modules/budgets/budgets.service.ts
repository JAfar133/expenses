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
  /** The currency of `limit`, `spent` and `remaining`: the requested one or the reporting currency of the group */
  currency: string;
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
  /** For amounts in another currency: the reporting currency of the group and the current rates */
  currencies?: {
    reportingCurrency: (groupId: string) => Promise<string | undefined>;
    rateOf: (currency: string) => Promise<number | undefined>;
    available: string[];
  };
  /** The clock (tests) */
  now?: () => Date;
}

const levelOf = (percent: number): BudgetLevel =>
  percent >= 100 ? 'over' : percent >= 80 ? 'warn' : 'ok';

/** Spending limits: everyone in the group sees the progress, only the owner changes the limits. */
export class BudgetsService {
  constructor(private readonly options: BudgetsServiceOptions) {}

  /**
   * The limits of the user's group with the spending of the current period (in the user's time zone).
   * With `currency` the amounts are in that currency: the spent amount counts a record entered in it exactly and converts
   * the others, the limit is converted at the current rate. The percent and the level always come from the reporting
   * currency of the group, so they do not change with the currency of the view.
   */
  async progress(user: AuthUser, currency?: string): Promise<BudgetProgress[]> {
    if (!user.groupId) return [];
    const budgets = await this.options.repository.list(user.groupId);
    const today = todayIn(user.timezone, (this.options.now ?? (() => new Date()))());
    const view = await this.viewOf(user.groupId, currency);

    return Promise.all(
      budgets.map(async (budget) => {
        const period = periodOf(budget.periodKind, budget.periodDay, today);
        const filters = {
          from: period.from,
          to: period.to,
          cards: [],
          categories: budget.category ? [budget.category] : [],
          createdBy: [],
          currencies: [],
          includeDeleted: false,
          scope: scopeOf(user),
        };
        const { total } = await this.options.analytics.summary(filters);
        const percent = (total / budget.limit) * 100;

        let shown = { spent: total, limit: budget.limit };
        if (view.display) {
          const inView = await this.options.analytics.summary({
            ...filters,
            display: view.display,
          });
          shown = { spent: inView.total, limit: budget.limit * view.factor };
        }
        return {
          ...budget,
          limit: shown.limit,
          currency: view.currency,
          period,
          spent: shown.spent,
          remaining: shown.limit - shown.spent,
          percent,
          level: levelOf(percent),
        };
      }),
    );
  }

  /** The currency of the view: the group's reporting one, or the requested one with its rate and the factor for limits. */
  private async viewOf(groupId: string, requested?: string) {
    const { currencies } = this.options;
    const reporting = (await currencies?.reportingCurrency(groupId)) ?? '';
    const code = requested?.toUpperCase();
    if (!code || !currencies || code === reporting) {
      return { currency: reporting, display: undefined, factor: 1 };
    }
    if (!currencies.available.includes(code)) {
      throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
    }
    const rate = await currencies.rateOf(code);
    const reportingRate = reporting ? await currencies.rateOf(reporting) : undefined;
    if (rate === undefined || !(rate > 0) || reportingRate === undefined) {
      throw validationError('RATE_UNAVAILABLE', `Курс валюты ${code} недоступен`);
    }
    return { currency: code, display: { currency: code, rate }, factor: reportingRate / rate };
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
