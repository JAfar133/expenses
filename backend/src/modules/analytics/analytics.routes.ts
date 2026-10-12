import type { FastifyPluginAsync } from 'fastify';
import { validationError } from '../../errors/app-error.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import { scopeOf } from '../groups/scope.ts';
import { parseQuery } from './analytics.filters.ts';
import type { RatesService } from '../rates/rates.service.ts';
import type { AnalyticsService } from './analytics.service.ts';
import type { AnalyticsFilters } from './analytics.types.ts';

/** Filters from the parsed query (without service parameters such as `by` and `limit`). */
function filtersOf(
  query: AnalyticsFilters,
  user: AuthUser,
  display?: AnalyticsFilters['display'],
): AnalyticsFilters {
  return {
    display,
    // The scope comes from the logged-in user: the query cannot widen it
    scope: scopeOf(user),
    from: query.from,
    to: query.to,
    cards: query.cards,
    categories: query.categories,
    createdBy: query.createdBy,
    currencies: query.currencies,
    q: query.q,
    minAmount: query.minAmount,
    maxAmount: query.maxAmount,
    includeDeleted: query.includeDeleted,
  };
}

export const analyticsRoutes =
  (
    analytics: AnalyticsService,
    groups: Pick<GroupsRepository, 'visibleCards'>,
    rates: Pick<RatesService, 'rateOf' | 'currencies'>,
  ): FastifyPluginAsync =>
  async (app) => {
    /** The currency of the request (`?currency=USD`) with its current rate; none: the group's reporting currency. */
    const displayOf = async (code?: string): Promise<AnalyticsFilters['display']> => {
      if (!code) return undefined;
      const currency = code.toUpperCase();
      if (!rates.currencies.includes(currency)) {
        throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
      }
      const rate = await rates.rateOf(currency);
      if (rate === undefined || !(rate > 0)) {
        throw validationError('RATE_UNAVAILABLE', `Курс валюты ${currency} недоступен`);
      }
      return { currency, rate };
    };
    const filtersFor = async (query: AnalyticsFilters & { currency?: string }, user: AuthUser) =>
      filtersOf(query, user, await displayOf(query.currency));

    app.get('/analytics/summary', async (request) => {
      const query = parseQuery('filters', request.query);
      return {
        success: true,
        data: await analytics.summary(
          await filtersFor(query, request.user!),
          request.user!.timezone,
        ),
      };
    });

    app.get('/analytics/breakdown', async (request) => {
      const query = parseQuery('breakdown', request.query);
      return {
        success: true,
        data: await analytics.breakdown(
          await filtersFor(query, request.user!),
          query.by,
          query.limit,
        ),
      };
    });

    app.get('/analytics/timeseries', async (request) => {
      const query = parseQuery('timeseries', request.query);
      return {
        success: true,
        data: await analytics.timeseries(
          await filtersFor(query, request.user!),
          query.granularity,
          query.splitBy,
          request.user!.timezone,
        ),
      };
    });

    /** The cards for the filter: every card the user can see, not only those with expenses. */
    app.get('/analytics/cards', async (request) => ({
      success: true,
      data: await groups.visibleCards(scopeOf(request.user!)),
    }));

    /** Expense authors for the "кто добавил" (who added) filter. */
    app.get('/analytics/authors', async (request) => ({
      success: true,
      data: await analytics.authors(scopeOf(request.user!)),
    }));

    /** List of operations: sorting and paging are done by the database. */
    app.get('/expenses', async (request) => {
      const query = parseQuery('list', request.query);
      const { sort, direction, limit, offset } = query;
      return {
        success: true,
        data: await analytics.list(await filtersFor(query, request.user!), {
          sort,
          direction,
          limit,
          offset,
        }),
      };
    });
  };
