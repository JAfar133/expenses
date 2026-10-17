import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../errors/app-error.ts';
import type { NotificationsService } from './notifications.service.ts';

const settingsSchema = z
  .object({
    push: z
      .object({
        types: z
          .object({
            expense_imported: z.boolean().optional(),
            import_problem: z.boolean().optional(),
            receipt_parsed: z.boolean().optional(),
          })
          .strict()
          .optional(),
        hideAmounts: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const readSchema = z.object({ ids: z.array(z.uuid()).max(200).optional() });

/** The signed-in user's own feed: nobody reads or changes another person's notifications. */
export const notificationsRoutes =
  (service: NotificationsService): FastifyPluginAsync =>
  async (app) => {
    app.get('/notifications', async (request) => {
      const query = request.query as { limit?: string; before?: string };
      return {
        success: true,
        data: await service.list(request.user!.id, {
          limit: Number(query.limit) || undefined,
          before: query.before,
        }),
      };
    });

    /** What reaches the phone as push (the bell always gets everything) */
    app.get('/notifications/settings', async (request) => ({
      success: true,
      data: { push: await service.pushSettings(request.user!.id) },
    }));

    /** Body: the same shape, any part of it; what is not given stays as it was */
    app.put('/notifications/settings', async (request) => {
      const parsed = settingsSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw validationError('INVALID_REQUEST', 'Некорректный запрос');
      return {
        success: true,
        data: { push: await service.savePushSettings(request.user!.id, parsed.data.push ?? {}) },
      };
    });

    /** A light request for the badge of the bell: polled while the app is open */
    app.get('/notifications/unread-count', async (request) => ({
      success: true,
      data: { unread: await service.unreadCount(request.user!.id) },
    }));

    /** Body: `{ ids?: [...] }`; without ids everything of the person is marked read */
    app.post('/notifications/read', async (request) => {
      const parsed = readSchema.safeParse(request.body ?? {});
      if (!parsed.success) throw validationError('INVALID_REQUEST', 'Некорректный запрос');
      await service.markRead(request.user!.id, parsed.data.ids);
      return { success: true };
    });
  };
