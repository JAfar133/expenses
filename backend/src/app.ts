import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { AppError, databaseUnavailableError } from './errors/app-error.ts';
import type { IdempotencyService } from './infrastructure/idempotency/idempotency.service.ts';
import { analyticsRoutes } from './modules/analytics/analytics.routes.ts';
import type { ReportService } from './modules/reports/report.service.ts';
import type { AnalyticsService } from './modules/analytics/analytics.service.ts';
import { authPlugin } from './modules/auth/auth.plugin.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import type { AuthService } from './modules/auth/auth.service.ts';
import { preferencesRoutes } from './modules/preferences/preferences.routes.ts';
import type { PreferencesRepository } from './modules/preferences/preferences.repository.ts';
import { ratesRoutes } from './modules/rates/rates.routes.ts';
import type { RatesService } from './modules/rates/rates.service.ts';
import type { GroupService } from './modules/groups/group.service.ts';
import type { GroupsRepository } from './modules/groups/groups.repository.ts';
import { adminRoutes, groupRoutes, invitationRoutes } from './modules/groups/groups.routes.ts';
import type { InvitationsService } from './modules/groups/invitations.service.ts';
import type { PlatformAdminService } from './modules/groups/platform-admin.service.ts';
import { ExpenseEditor } from './modules/expenses/expense-editor.ts';
import { expenseEditRoutes } from './modules/expenses/expense-edit.routes.ts';
import { expensesRoutes } from './modules/expenses/expenses.routes.ts';
import type { ExpenseService } from './modules/expenses/expenses.service.ts';
import type { SyncSwitch } from './modules/sync/sync-switch.ts';
import type { SyncScheduler } from './modules/sync/sync.scheduler.ts';
import { syncRoutes } from './modules/sync/sync.routes.ts';
import type { SyncService } from './modules/sync/sync.service.ts';

export interface AppDependencies {
  expenseService: ExpenseService;
  auth: AuthService;
  rates: Pick<RatesService, 'snapshot' | 'currencies' | 'rateOf'>;
  analytics: AnalyticsService;
  /** The Excel report */
  report: ReportService;
  /** User interface settings */
  preferences: Pick<PreferencesRepository, 'get' | 'merge'>;
  /** Editing and deleting records */
  editor: ExpenseEditor;
  /** Cards of a group (for the default card in the profile) */
  groups: Pick<GroupsRepository, 'cardNames' | 'reportingCurrency' | 'visibleCards'>;
  /** Management of the user's own group (owner) */
  groupService: GroupService;
  /** Groups for the application administrator */
  platformAdmin: PlatformAdminService;
  /** Invitation links */
  invitations: InvitationsService;
  /** Logins allowed to edit and delete */
  editors?: string[];
  idempotency: IdempotencyService;
  sync: SyncService;
  scheduler: SyncScheduler;
  /** The administrator's switch of the Excel sync */
  syncSwitch?: SyncSwitch;
  /** Database check for `/api/ready`; without it the endpoint always reports ready */
  checkDatabase?: () => Promise<unknown>;
  /** How long to wait for the Excel write before responding to expense creation */
  inlineExcelWaitMs?: number;
  currency?: string;
  /** Behind a reverse proxy (Caddy): the real IP and protocol are taken from X-Forwarded-* */
  trustProxy?: boolean;
  /** Additional allowed request origins (Origin) */
  allowedOrigins?: string[];
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({
  expenseService,
  auth,
  rates,
  analytics,
  report,
  preferences,
  editor,
  groups,
  groupService,
  platformAdmin,
  invitations,
  idempotency,
  sync,
  scheduler,
  syncSwitch,
  checkDatabase,
  inlineExcelWaitMs = 15_000,
  currency = 'AMD',
  trustProxy = false,
  allowedOrigins = [],
  logger = false,
}: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger,
    trustProxy,
    // A short request id goes into every log line and the response header
    genReqId: () => randomUUID().slice(0, 8),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  });

  // Clients often send `Content-Type: application/json` even for requests without a body (e.g. POST /api/sync).
  // An empty body is allowed, while broken JSON still yields 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(Object.assign(error as Error, { statusCode: 400 }), undefined);
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  app.setErrorHandler((rawError, request, reply) => {
    // An unavailable DB means "try again later", not an internal error
    const error = isConnectionError(rawError) ? databaseUnavailableError(rawError) : rawError;

    // For application errors the log line has already been written in the operation handler
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .headers(error.headers ?? {})
        .send(errorBody(error.code, error.message));
    }

    // Fastify errors raised before our handlers: broken JSON, wrong Content-Type, etc.
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('BAD_REQUEST', 'Некорректный запрос'));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply
      .code(500)
      .send(errorBody('INTERNAL_ERROR', 'Не удалось сохранить расход. Попробуйте позже'));
  });

  // Cookie parsing and login checks first, then routes: the hooks must be registered before them
  app.register(authPlugin, { auth, allowedOrigins });

  // Liveness: the process answers. Readiness: the database answers too
  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }));
  app.get('/api/ready', { config: { public: true } }, async (_request, reply) => {
    try {
      await checkDatabase?.();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  // `currency`: the reporting currency of the user's group (what totals and charts are in);
  // `baseCurrency`: the currency of the drams amount (rates are quoted against it)
  app.get('/api/config', async (request) => ({
    success: true,
    data: {
      currency: (await groups.reportingCurrency(request.user!.groupId)) ?? currency,
      baseCurrency: currency,
    },
  }));
  app.register(expensesRoutes({ expenseService, idempotency, sync, inlineExcelWaitMs }), {
    prefix: '/api',
  });
  app.register(ratesRoutes(rates), { prefix: '/api' });
  app.register(preferencesRoutes(preferences), { prefix: '/api' });
  app.register(analyticsRoutes(analytics, groups, report, rates), { prefix: '/api' });
  app.register(
    expenseEditRoutes({
      editor,
      repository: expenseService,
      sync,
      inlineExcelWaitMs,
    }),
    { prefix: '/api' },
  );
  app.register(groupRoutes(groupService), { prefix: '/api' });
  app.register(adminRoutes(platformAdmin), { prefix: '/api' });
  app.register(invitationRoutes(invitations, auth), { prefix: '/api' });
  app.register(syncRoutes({ sync, scheduler, syncSwitch }), { prefix: '/api' });
  app.register(
    authRoutes(auth, (user) =>
      user.groupId ? groups.cardNames(user.groupId) : Promise.resolve([]),
    ),
    { prefix: '/api' },
  );

  return app;
}

const errorBody = (code: string, message: string) => ({
  success: false,
  error: { code, message },
});

/** Node network error codes and PostgreSQL "server unavailable / shutting down" errors. */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  '57P01',
  '57P03',
  '08006',
  '08001',
]);

const isConnectionError = (error: unknown): boolean =>
  CONNECTION_ERROR_CODES.has((error as { code?: string })?.code ?? '');
