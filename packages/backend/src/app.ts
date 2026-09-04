import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { createAuthorizer } from './auth/authorization.js';
import { LocalAuthProvider } from './auth/local-provider.js';
import { AuthProviderRegistry } from './auth/provider.js';
import { createSessionService } from './auth/sessions.js';
import { createTokenService } from './auth/token-service.js';
import type { Config } from './config.js';
import { createDatabase, createPool } from './db/client.js';
import { createAuthenticator } from './http/authenticate.js';
import { registerErrorHandler } from './http/errors.js';
import { registerHttpPlugins } from './http/plugin.js';
import { registerAuthRoutes } from './http/routes/auth.js';
import { registerCoverageRoutes } from './http/routes/coverage.js';
import { registerExecutionRoutes } from './http/routes/execution.js';
import { registerIngestionRoutes } from './http/routes/ingestion.js';
import { registerLifecycleRoutes } from './http/routes/lifecycle.js';
import { registerMemberRoutes } from './http/routes/members.js';
import { registerPlanningRoutes } from './http/routes/planning.js';
import { registerReportingRoutes } from './http/routes/reporting.js';
import { registerRepositoryRoutes } from './http/routes/repository.js';
import { registerMcpRoutes } from './mcp/server.js';
import { createObjectStore } from './services/storage.js';

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: true });

  const pool = createPool(config.DATABASE_URL);
  const db = createDatabase(pool);
  const sessions = createSessionService(db);
  const tokens = createTokenService(db);
  const authorizer = createAuthorizer(db);
  const providers = new AuthProviderRegistry().register(new LocalAuthProvider(db));
  const store = createObjectStore({
    endpoint: config.S3_ENDPOINT,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    region: config.S3_REGION,
  });

  const multipart = (await import('@fastify/multipart')).default;
  await app.register(multipart, { limits: { fileSize: config.ATTACHMENT_MAX_BYTES } });

  await registerHttpPlugins(app, {
    authenticate: createAuthenticator({
      sessions,
      tokens,
      isMcpRequest: (request) => request.url.startsWith('/mcp'),
    }),
    corsOrigin: config.CORS_ORIGIN,
    cookieSecret: config.COOKIE_SECRET,
  });
  // The ingest endpoint receives raw JUnit XML; Fastify rejects unknown content types
  // unless a parser is registered for them.
  for (const contentType of ['application/xml', 'text/xml', 'application/octet-stream']) {
    app.addContentTypeParser(contentType, { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });
  }

  registerErrorHandler(app);

  /** Liveness: the process is up. Deliberately checks no dependency. */
  app.get('/healthz', async () => ({ status: 'ok' }));

  /** Readiness: dependencies are reachable. Used by orchestrators to gate traffic. */
  app.get('/readyz', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready', checks: { database: 'ok' } };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.status(503).send({ status: 'not_ready', checks: { database: 'unreachable' } });
    }
  });

  registerAuthRoutes(app, { db, sessions, providers, secure: config.NODE_ENV === 'production' });
  registerMemberRoutes(app, { db, authorizer });
  registerRepositoryRoutes(app, { db, authorizer });
  registerIngestionRoutes(app, { db, authorizer, config });
  registerCoverageRoutes(app, { db, authorizer });
  registerPlanningRoutes(app, { db, authorizer });
  registerExecutionRoutes(app, { db, authorizer, store, config });
  registerReportingRoutes(app, { db, authorizer, config });
  registerLifecycleRoutes(app, { db, authorizer, store, config });
  registerMcpRoutes(app, { db, authorizer, config });

  // The bucket must exist before the first upload, so it is created at startup and the
  // deployment stays a single `docker compose up` with no manual provisioning step.
  //
  // Deliberately not awaited: object storage being slow or unreachable must not delay the
  // API from serving everything that does not involve attachments. The S3 client's own
  // retries can run for tens of seconds, which would otherwise stall startup entirely.
  app.addHook('onReady', () => {
    void store
      .ensureBucket()
      .catch((error: unknown) =>
        app.log.error({ err: error }, 'could not ensure the attachment bucket exists'),
      );
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  // Exposed for tests and for the MCP server, which shares this exact authorizer.
  app.decorate('deps', { db, sessions, tokens, authorizer, providers, store });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: {
      db: ReturnType<typeof createDatabase>;
      sessions: ReturnType<typeof createSessionService>;
      tokens: ReturnType<typeof createTokenService>;
      authorizer: ReturnType<typeof createAuthorizer>;
      providers: AuthProviderRegistry;
      store: ReturnType<typeof createObjectStore>;
    };
  }
}
