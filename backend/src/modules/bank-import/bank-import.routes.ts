import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sanitizePayload, textOf } from './payload.ts';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import type { ApiKeysService } from './api-keys.service.ts';
import type { BankImportService, ImportResult } from './import.service.ts';
import type { ImportLogRepository } from './import-log.repository.ts';
import { RateLimiter } from './rate-limit.ts';

const idOf = (request: { params: unknown }): string => {
  const parsed = z.uuid().safeParse((request.params as { id: string }).id);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор');
  return parsed.data;
};

const LOG_LIMIT = 30;
/** An import request is a few hundred bytes; the limit stops anything much bigger before it is read */
const MAX_BODY_BYTES = 32 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface BankImportRoutesDeps {
  keys: ApiKeysService;
  imports: BankImportService;
  log: Pick<ImportLogRepository, 'list' | 'deleteOlderThan'>;
  /** Requests per minute for one key and for one address with unknown keys (tests lower them) */
  limits?: { perKey: number; badKeysPerAddress: number };
  now?: () => number;
}

/**
 * The public import endpoint (authorised by a key, not by a login: iOS Shortcuts has no session) and the owner's
 * management of the keys (by login). The key never travels in a URL and is never logged.
 */
export const bankImportRoutes =
  ({ keys, imports, log, limits, now }: BankImportRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const perKey = new RateLimiter(limits?.perKey ?? 60, 60_000, now);
    const badKeys = new RateLimiter(limits?.badKeysPerAddress ?? 20, 60_000, now);

    app.post(
      '/v1/transactions/import',
      { config: { public: true, apiKey: true }, bodyLimit: MAX_BODY_BYTES },
      async (request, reply) => {
        const presented = bearerOf(request.headers.authorization);
        const key = await keys.authenticate(presented);
        if (!key) {
          if (!badKeys.allow(request.ip)) return tooMany(reply);
          return reply.code(401).send({ success: false, status: 'unauthorized' });
        }
        if (!perKey.allow(key.id)) return tooMany(reply);

        // The contract is source, title, body; anything else (device, amount, merchant…) comes along and is kept
        const body = request.body;
        const source = isRecord(body) ? textOf(body.source)?.trim() : undefined;
        if (!isRecord(body) || !source || source.length > 40) {
          return reply.code(400).send({ success: false, status: 'invalid_request' });
        }
        const title = textOf(body.title) ?? '';
        const text = textOf(body.body) ?? '';
        // The bank's notice is nothing without its text; Wallet may carry its data in other fields
        if (source.toLowerCase() === 'idbank' && !text.trim()) {
          return reply.code(400).send({ success: false, status: 'invalid_request' });
        }
        const result = await imports.import(key, {
          source,
          title,
          body: text,
          raw: sanitizePayload(body),
        });
        request.log.info(
          { operation: 'transaction-import', source, status: result.status, keyId: key.id },
          'Import request processed',
        );
        return sendResult(reply, result);
      },
    );

    app.get('/group/import-log', async (request) => {
      const user = request.user!;
      if (user.role !== 'owner' || !user.groupId) throw forbiddenError();
      const query = request.query as { limit?: string; source?: string };
      const limit = Math.min(Math.max(Number(query.limit) || LOG_LIMIT, 1), 100);
      return { success: true, data: await log.list(user.groupId, limit, query.source) };
    });

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
    case 'unrecognized':
      // Accepted and kept in the log, no expense: the client sees a success, not an error to retry
      return reply.code(200).send({
        success: true,
        status: 'unrecognized',
        importId: result.importId,
        message: result.message,
      });
    case 'unknown_source':
      return reply.code(400).send({
        success: false,
        status: 'unknown_source',
        importId: result.importId,
        message: 'Неизвестный источник',
      });
    default:
      return reply.code(422).send({
        success: false,
        status: result.status,
        importId: result.importId,
        message: result.message,
      });
  }
}
