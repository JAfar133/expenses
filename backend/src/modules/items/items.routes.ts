import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../errors/app-error.ts';
import type { ItemsService } from './items.service.ts';

const idSchema = z.uuid();
const parseId = (params: unknown) => {
  const parsed = idSchema.safeParse((params as { id?: string }).id);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор записи');
  return parsed.data;
};

/** Items (positions) of an expense. */
export const itemsRoutes =
  (service: ItemsService): FastifyPluginAsync =>
  async (app) => {
    app.get('/expenses/:id/items', async (request) => ({
      success: true,
      data: await service.list(request.user!, parseId(request.params)),
    }));

    app.put('/expenses/:id/items', async (request) => ({
      success: true,
      data: await service.replace(request.user!, parseId(request.params), request.body),
    }));
  };
