import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import type { ApiKeysService } from './api-keys.service.ts';
import type { BankImportService, ImportResult } from './import.service.ts';
import type { BankImportsRepository } from './imports.repository.ts';
import { RateLimiter } from './rate-limit.ts';

const payloadSchema = z.object({
  source: z.string().trim().min(1).max(40),
  title: z.string().max(300).default(''),
  body: z.string().min(1).max(4000),
});

const idOf = (request: { params: unknown }): string => {
  const parsed = z.uuid().safeParse((request.params as { id: string }).id);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор');
  return parsed.data;
};

const HISTORY_LIMIT = 30;

export interface BankImportRoutesDeps {
  keys: ApiKeysService;
  imports: BankImportService;
  history: Pick<BankImportsRepository, 'recent'>;
  /** Requests per minute for one key and for one address with unknown keys (tests lower them) */
  limits?: { perKey: number; badKeysPerAddress: number };
  now?: () => number;
}

/**
 * The public import endpoint (authorised by a key, not by a login: iOS Shortcuts has no session) and the owner's
 * management of the keys (by login). The key never travels in a URL and is never logged.
 */
export const bankImportRoutes =
  ({ keys, imports, history, limits, now }: BankImportRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const perKey = new RateLimiter(limits?.perKey ?? 60, 60_000, now);
    const badKeys = new RateLimiter(limits?.badKeysPerAddress ?? 20, 60_000, now);

    app.post(
      '/v1/transactions/import',
      { config: { public: true, apiKey: true } },
      async (request, reply) => {
        const presented = bearerOf(request.headers.authorization);
        const key = await keys.authenticate(presented);
        if (!key) {
          if (!badKeys.allow(request.ip)) return tooMany(reply);
          return reply.code(401).send({ success: false, status: 'unauthorized' });
        }
        if (!perKey.allow(key.id)) return tooMany(reply);

        const parsed = payloadSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ success: false, status: 'invalid_request' });
        }
        const result = await imports.import(key, parsed.data);
        return sendResult(reply, result);
      },
    );

    app.get('/group/api-keys', async (request) => ({
      success: true,
      data: await keys.list(request.user!),
    }));

    app.post('/group/api-keys', async (request, reply) => {
      const body = (request.body ?? {}) as { name?: unknown; defaultCategory?: unknown };
      const created = await keys.create(request.user!, body.name, body.defaultCategory);
      // The key itself is in this response only: it cannot be read again
      return reply.code(201).send({ success: true, data: created });
    });

    /** Body: `{ name?, defaultCategory? }` (`defaultCategory: null` removes it). */
    app.patch('/group/api-keys/:id', async (request) => {
      const body = (request.body ?? {}) as { name?: unknown; defaultCategory?: unknown };
      await keys.update(request.user!, idOf(request), body);
      return { success: true };
    });

    app.delete('/group/api-keys/:id', async (request) => {
      await keys.revoke(request.user!, idOf(request));
      return { success: true };
    });

    app.get('/group/imports', async (request) => {
      if (request.user!.role !== 'owner' || !request.user!.groupId) throw forbiddenError();
      return { success: true, data: await history.recent(request.user!.groupId, HISTORY_LIMIT) };
    });
  };

const bearerOf = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
};

const tooMany = (reply: FastifyReply) =>
  reply.code(429).header('Retry-After', '60').send({ success: false, status: 'rate_limited' });

function sendResult(reply: FastifyReply, result: ImportResult) {
  switch (result.status) {
    case 'created':
      return reply
        .code(201)
        .send({ success: true, status: 'created', transactionId: result.transactionId });
    case 'duplicate':
      return reply.code(200).send({
        success: true,
        status: 'duplicate',
        ...(result.transactionId ? { transactionId: result.transactionId } : {}),
      });
    case 'unknown_source':
      return reply
        .code(400)
        .send({ success: false, status: 'unknown_source', message: 'Неизвестный банк' });
    default:
      return reply
        .code(422)
        .send({ success: false, status: result.status, message: result.message });
  }
}
