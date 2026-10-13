import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../errors/app-error.ts';
import type { SyncService } from '../sync/sync.service.ts';
import type { ReceiptAnalysisService } from './receipt-analysis.service.ts';

const idSchema = z.uuid();
const bodySchema = z.object({ replaceItems: z.boolean().optional() }).strict();

/** Parsing the receipt photo of an expense with the AI. */
export const expenseAiRoutes =
  (
    service: ReceiptAnalysisService,
    sync: Pick<SyncService, 'requestCycle' | 'enabled'>,
  ): FastifyPluginAsync =>
  async (app) => {
    const parseId = (params: unknown) => {
      const parsed = idSchema.safeParse((params as { id?: string }).id);
      if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор записи');
      return parsed.data;
    };

    app.post('/expenses/:id/receipt/parse', async (request) => {
      const id = parseId(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
      if (!body.success) throw validationError('INVALID_REQUEST', 'Некорректный запрос');

      const data = await service.analyze(request.user!, id, body.data);
      request.log.info(
        { operation: 'expense.receipt.parse', expenseId: id, userId: request.user!.username },
        'Operation completed',
      );
      // The name or the date may have changed: let the Excel mirror catch up
      if (sync.enabled && (data.nameFilled || data.dateFilled)) void sync.requestCycle();
      return { success: true, data };
    });

    /** "Remove the AI marks": the values stay, the person takes them as their own. */
    app.delete('/expenses/:id/ai', async (request) => {
      await service.removeMarks(request.user!, parseId(request.params));
      return { success: true };
    });
  };
