import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../errors/app-error.ts';
import type { TemplatesService } from './templates.service.ts';

const parseId = (value: unknown) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор');
  return parsed.data;
};
const idOf = (request: { params: unknown }) => parseId((request.params as { id: string }).id);

/** Quick-action templates of the signed-in user (their own and the group ones). */
export const templatesRoutes =
  (service: TemplatesService): FastifyPluginAsync =>
  async (app) => {
    app.get('/templates', async (request) => ({
      success: true,
      data: await service.list(request.user!),
    }));

    app.post('/templates', async (request, reply) => {
      const id = await service.create(request.user!, request.body);
      return reply.code(201).send({ success: true, data: { id } });
    });

    // Registered before `/templates/:id`, so "order" is not taken for an id
    app.put('/templates/order', async (request) => {
      await service.reorder(request.user!, request.body);
      return { success: true };
    });

    // The default order of the group templates: the owner's
    app.put('/templates/group-order', async (request) => {
      await service.reorderGroup(request.user!, request.body);
      return { success: true };
    });

    app.put('/templates/:id', async (request) => {
      await service.update(request.user!, idOf(request), request.body);
      return { success: true };
    });

    app.delete('/templates/:id', async (request) => {
      await service.remove(request.user!, idOf(request));
      return { success: true };
    });

    /** A member proposes a personal template to the group, the owner of the group publishes it at once. */
    app.post('/templates/:id/share', async (request, reply) => {
      const status = await service.share(request.user!, idOf(request));
      return reply.code(201).send({ success: true, data: { status } });
    });

    /** The owner of the group turns a proposal on. */
    app.post('/templates/:id/approve', async (request) => {
      await service.approve(request.user!, idOf(request));
      return { success: true };
    });

    app.put('/templates/:id/hidden', async (request) => {
      await service.setHidden(request.user!, idOf(request), request.body);
      return { success: true };
    });
  };
