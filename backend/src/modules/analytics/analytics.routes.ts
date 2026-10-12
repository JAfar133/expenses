import type { FastifyPluginAsync } from 'fastify';
import type { AuthUser } from '../auth/auth.types.ts';
import { scopeOf } from '../groups/scope.ts';
import { parseQuery } from './analytics.filters.ts';
import type { AnalyticsService } from './analytics.service.ts';
import type { AnalyticsFilters } from './analytics.types.ts';

/** Filters from the parsed query (without service parameters such as `by` and `limit`). */
function filtersOf(query: AnalyticsFilters, user: AuthUser): AnalyticsFilters {
  return {
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
  (analytics: AnalyticsService): FastifyPluginAsync =>
  async (app) => {
    app.get('/analytics/summary', async (request) => {
      const query = parseQuery('filters', request.query);
      return {
        success: true,
        data: await analytics.summary(filtersOf(query, request.user!), request.user!.timezone),
      };
    });

    app.get('/analytics/breakdown', async (request) => {
      const query = parseQuery('breakdown', request.query);
      return {
        success: true,
        data: await analytics.breakdown(filtersOf(query, request.user!), query.by, query.limit),
      };
    });

    app.get('/analytics/timeseries', async (request) => {
      const query = parseQuery('timeseries', request.query);
      return {
        success: true,
        data: await analytics.timeseries(
          filtersOf(query, request.user!),
          query.granularity,
          query.splitBy,
          request.user!.timezone,
        ),
      };
    });

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
        data: await analytics.list(filtersOf(query, request.user!), {
          sort,
          direction,
          limit,
          offset,
        }),
      };
    });
  };
