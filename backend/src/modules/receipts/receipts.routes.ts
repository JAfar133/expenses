import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notFoundError, validationError } from '../../errors/app-error.ts';
import { MAX_RECEIPT_BYTES, type ReceiptsService } from './receipts.service.ts';

const idSchema = z.uuid();
const parseId = (params: unknown) => {
  const parsed = idSchema.safeParse((params as { id?: string }).id);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор записи');
  return parsed.data;
};

/**
 * Receipt photos. The photo is sent as the raw request body (image/jpeg, image/png or image/webp): the client
 * shrinks it first. Rights are the same as for the expense itself (see ReceiptsService).
 */
export const receiptsRoutes =
  (service: ReceiptsService): FastifyPluginAsync =>
  async (app) => {
    app.get('/receipts/settings', async (request) => ({
      success: true,
      data: await service.settings(request.user!),
    }));

    app.put('/group/receipts', async (request) => {
      await service.saveSettings(request.user!, request.body);
      return { success: true };
    });

    app.put('/expenses/:id/receipt', { bodyLimit: MAX_RECEIPT_BYTES + 1024 }, async (request) => {
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        throw validationError('INVALID_RECEIPT', 'Нужна фотография в формате JPEG, PNG или WebP');
      }
      await service.attach(request.user!, parseId(request.params), body);
      return { success: true, message: 'Фото чека сохранено' };
    });

    app.get('/expenses/:id/receipt', async (request, reply) => {
      const receipt = await service.read(request.user!, parseId(request.params));
      if (!receipt) throw notFoundError();
      return reply
        .header('Content-Type', receipt.contentType)
        .header('Cache-Control', 'private, max-age=300')
        .header('X-Content-Type-Options', 'nosniff')
        .send(receipt.bytes);
    });

    app.delete('/expenses/:id/receipt', async (request) => {
      await service.remove(request.user!, parseId(request.params));
      return { success: true, message: 'Фото чека убрано' };
    });
  };
