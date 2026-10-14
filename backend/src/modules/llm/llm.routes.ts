import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import type { LlmRepository } from './llm.repository.ts';
import type { LlmService } from './llm.service.ts';
import type { LlmSettingsRepository } from './llm.settings.ts';
import { AI_LANGUAGES } from './receipt-parser.ts';

const settingsBody = z
  .object({
    enabled: z.boolean(),
    model: z.string(),
    dailyLimit: z.number(),
  })
  .partial()
  .strict();
const keyBody = z.object({ apiKey: z.string() }).strict();
const groupBody = z
  .object({
    enabled: z.boolean().optional(),
    languages: z.array(z.enum(AI_LANGUAGES)).min(1).max(AI_LANGUAGES.length).optional(),
  })
  .strict()
  .refine((body) => body.enabled !== undefined || body.languages !== undefined);
const limitBody = z.object({ limit: z.number().int().min(0).max(100_000).nullable() }).strict();

const adminOnly = (request: FastifyRequest) => {
  if (!request.user?.isAdmin) throw forbiddenError();
};

const bodyOf = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw validationError('INVALID_REQUEST', 'Некорректный запрос');
  return parsed.data;
};

export interface LlmRoutesDeps {
  service: LlmService;
  settings: LlmSettingsRepository;
  repository: LlmRepository;
}

/**
 * AI settings. The installation level (key, model, limit, switch) belongs to the administrator,
 * the group switch to the group owner. The key is only ever written here, never returned.
 */
export const llmRoutes =
  ({ service, settings, repository }: LlmRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    /** Whether parsing may be offered to the user (both switches on, key set). */
    app.get('/ai/status', async (request) => ({
      success: true,
      data: await service.status(request.user!.groupId),
    }));

    app.put('/group/ai', async (request) => {
      const user = request.user!;
      if (user.role !== 'owner' || !user.groupId) throw forbiddenError();
      const body = bodyOf(groupBody, request.body);
      if (body.enabled !== undefined) await repository.setGroupEnabled(user.groupId, body.enabled);
      if (body.languages) {
        await repository.setGroupLanguages(user.groupId, [...new Set(body.languages)]);
      }
      return { success: true };
    });

    app.get('/admin/ai', async (request) => {
      adminOnly(request);
      return {
        success: true,
        data: { ...(await service.adminView()), groups: await repository.groupsOverview() },
      };
    });

    app.put('/admin/ai', async (request) => {
      adminOnly(request);
      await settings.update(bodyOf(settingsBody, request.body));
      return { success: true };
    });

    app.put('/admin/ai/key', async (request) => {
      adminOnly(request);
      await settings.setApiKey(bodyOf(keyBody, request.body).apiKey);
      request.log.info({ operation: 'ai.key.set', userId: request.user!.username }, 'AI key saved');
      return { success: true };
    });

    app.delete('/admin/ai/key', async (request) => {
      adminOnly(request);
      await settings.clearApiKey();
      request.log.info(
        { operation: 'ai.key.clear', userId: request.user!.username },
        'AI key removed',
      );
      return { success: true };
    });

    app.post('/admin/ai/test', async (request) => {
      adminOnly(request);
      const { model } = await service.check();
      const message = `Ключ работает, модель «${model}» доступна`;
      return { success: true, data: { model, message }, message };
    });

    app.put('/admin/groups/:id/ai-limit', async (request) => {
      adminOnly(request);
      const id = z.uuid().safeParse((request.params as { id?: string }).id);
      if (!id.success) throw validationError('INVALID_ID', 'Некорректный идентификатор группы');
      const { limit } = bodyOf(limitBody, request.body);
      if (!(await repository.setGroupLimit(id.data, limit))) {
        throw validationError('GROUP_NOT_FOUND', 'Группа не найдена');
      }
      return { success: true };
    });
  };
