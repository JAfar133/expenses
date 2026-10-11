import type { FastifyPluginAsync } from 'fastify';
import type { RatesService } from './rates.service.ts';

/** Базовая валюта, доступные валюты и курсы к драму: форма пересчитывает сумму на лету. */
export const ratesRoutes =
  (rates: Pick<RatesService, 'snapshot' | 'currencies'>): FastifyPluginAsync =>
  async (app) => {
    app.get('/rates', async () => ({
      success: true,
      data: { ...(await rates.snapshot()), currencies: rates.currencies },
    }));
  };
