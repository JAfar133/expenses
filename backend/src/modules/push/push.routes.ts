import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../errors/app-error.ts';
import type { PushService } from './push.service.ts';

const subscribeSchema = z.object({
  endpoint: z.string().min(1).max(1000),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
  label: z.string().max(80).optional(),
});
const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(1000) });

/** The devices of the signed-in person. Nobody reaches the devices of another person. */
export const pushRoutes =
  (service: PushService): FastifyPluginAsync =>
  async (app) => {
    const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
      const parsed = schema.safeParse(body ?? {});
      if (!parsed.success) throw validationError('INVALID_REQUEST', 'Некорректный запрос');
      return parsed.data;
    };

    /** The app asks what to do: is Web Push on at all, and the public key for the browser */
    app.get('/push/config', async () => ({ success: true, data: service.config() }));

    app.get('/push/subscriptions', async (request) => ({
      success: true,
      data: await service.list(request.user!.id),
    }));

    app.post('/push/subscriptions', async (request, reply) => {
      const input = parse(subscribeSchema, request.body);
      const saved = await service.subscribe(request.user!.id, input, request.headers['user-agent']);
      return reply.code(201).send({ success: true, data: saved });
    });

    app.delete('/push/subscriptions/:id', async (request) => {
      const id = z.uuid().safeParse((request.params as { id: string }).id);
      if (!id.success) throw validationError('INVALID_ID', 'Некорректный идентификатор');
      await service.remove(request.user!.id, id.data);
      return { success: true };
    });

    /** The device signs out: it stops getting this person's messages (no id needed, only its own address) */
    app.post('/push/subscriptions/unsubscribe', async (request) => {
      const { endpoint } = parse(unsubscribeSchema, request.body);
      await service.unsubscribe(request.user!.id, endpoint);
      return { success: true };
    });
  };
