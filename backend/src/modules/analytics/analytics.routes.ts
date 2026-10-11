import type { FastifyPluginAsync } from 'fastify';
import { parseQuery } from './analytics.filters.ts';
import type { AnalyticsService } from './analytics.service.ts';
import type { AnalyticsFilters } from './analytics.types.ts';

/** Фильтры из разобранного запроса (без служебных параметров вроде `by` и `limit`). */
function filtersOf(query: AnalyticsFilters): AnalyticsFilters {
  return {
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
      return { success: true, data: await analytics.summary(filtersOf(query)) };
    });

    app.get('/analytics/breakdown', async (request) => {
      const query = parseQuery('breakdown', request.query);
      return {
        success: true,
        data: await analytics.breakdown(filtersOf(query), query.by, query.limit),
      };
    });

    app.get('/analytics/timeseries', async (request) => {
      const query = parseQuery('timeseries', request.query);
      return {
        success: true,
        data: await analytics.timeseries(filtersOf(query), query.granularity, query.splitBy),
      };
    });

    /** Авторы расходов для фильтра «кто добавил». */
    app.get('/analytics/authors', async () => ({ success: true, data: await analytics.authors() }));

    /** Список операций: сортировка и страницы выполняет база. */
    app.get('/expenses', async (request) => {
      const query = parseQuery('list', request.query);
      const { sort, direction, limit, offset } = query;
      return {
        success: true,
        data: await analytics.list(filtersOf(query), { sort, direction, limit, offset }),
      };
    });
  };
