import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../errors/app-error.ts';
import type { BroadcastService } from './broadcast.service.ts';
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
            announcement: z.boolean().optional(),
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
  (service: NotificationsService, broadcast: BroadcastService): FastifyPluginAsync =>
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

    /** The people the signed-in owner (their group) or administrator (everyone) may write to */
    app.get('/notifications/recipients', async (request) => ({
      success: true,
      data: await broadcast.addressees(request.user!),
    }));

    app.get('/notifications/broadcasts', async (request) => ({
      success: true,
      data: await broadcast.history(request.user!),
    }));

    /** Body: `{ text, title?, audience: {type:'group'} | {type:'all'} | {type:'users', userIds:[…]} }` */
    app.post('/notifications/broadcast', async (request, reply) => {
      const result = await broadcast.send(request.user!, (request.body ?? {}) as object);
      return reply.code(201).send({ success: true, data: result });
    });

    /**
     * The app keeps this connection open (Server-Sent Events): a new notification changes its badge at once.
     * The first message carries the current number, then every change; a comment every 25 seconds keeps the
     * connection alive through proxies. The browser reconnects by itself.
     */
    // Open streams are ended when the server stops, otherwise a restart would wait for every tab to leave
    const streams = new Set<{ end: () => void }>();
    app.addHook('onClose', async () => {
      for (const stream of streams) stream.end();
    });

    app.get('/notifications/stream', async (request, reply) => {
      const userId = request.user!.id;
      reply.hijack();
      const raw = reply.raw;
      streams.add(raw);
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        // Caddy must not compress or buffer a stream
        'Content-Encoding': 'identity',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      const write = (text: string) => {
        if (!raw.destroyed && !raw.writableEnded) raw.write(text);
      };
      write('retry: 5000\n\n');
      const send = (unread: number) =>
        write(`event: unread\ndata: ${JSON.stringify({ unread })}\n\n`);
      const stop = service.hub.subscribe(userId, (event) => send(event.unread));
      send(await service.unreadCount(userId));
      const keepAlive = setInterval(() => write(': ping\n\n'), 25_000);
      keepAlive.unref();
      request.raw.on('close', () => {
        clearInterval(keepAlive);
        stop();
        streams.delete(raw);
      });
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
