import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import type { BudgetsService } from './budgets.service.ts';

const idSchema = z.uuid();
const parseId = (value: unknown) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор');
  return parsed.data;
};

const ownerOnly = (request: FastifyRequest) => {
  if (request.user?.role !== 'owner' || !request.user.groupId) throw forbiddenError();
  return request.user;
};

/**
 * Spending limits. Everyone in the group sees the progress (by the cards they may see); only the owner
 * creates, changes and deletes the limits.
 */
export const budgetsRoutes =
  (service: BudgetsService): FastifyPluginAsync =>
  async (app) => {
    /** `?currency=USD` shows the amounts in that currency (the percent and the level do not depend on it). */
    app.get('/budgets', async (request) => {
      const currency = (request.query as { currency?: string }).currency;
      return { success: true, data: await service.progress(request.user!, currency || undefined) };
    });

    app.post('/group/budgets', async (request, reply) => {
      const id = await service.create(ownerOnly(request), request.body);
      return reply.code(201).send({ success: true, data: { id } });
    });

    app.put('/group/budgets/:id', async (request) => {
      await service.update(
        ownerOnly(request),
        parseId((request.params as { id: string }).id),
        request.body,
      );
      return { success: true };
    });

    app.delete('/group/budgets/:id', async (request) => {
      await service.remove(ownerOnly(request), parseId((request.params as { id: string }).id));
      return { success: true };
    });
  };
