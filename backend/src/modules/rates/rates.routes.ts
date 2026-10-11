import type { FastifyPluginAsync } from 'fastify';
import type { RatesService } from './rates.service.ts';

/** Base currency, available currencies and rates to the dram: the form converts the amount on the fly. */
export const ratesRoutes =
  (rates: Pick<RatesService, 'snapshot' | 'currencies'>): FastifyPluginAsync =>
  async (app) => {
    app.get('/rates', async () => ({
      success: true,
      data: { ...(await rates.snapshot()), currencies: rates.currencies },
    }));
  };
