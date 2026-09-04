import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { Principal } from '../auth/authorization.js';
import type { Authenticator } from './authenticate.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated caller, or null. Populated once per request, before routing. */
    principal: Principal | null;
  }
}

export async function registerHttpPlugins(
  app: FastifyInstance,
  deps: { authenticate: Authenticator; corsOrigin: string; cookieSecret: string },
): Promise<void> {
  await app.register(cookie, { secret: deps.cookieSecret });
  await app.register(cors, { origin: deps.corsOrigin, credentials: true });

  app.decorateRequest('principal', null);

  // Authentication runs for every request; authorisation is per-operation and always
  // resolves through the single authorizer (design Decision 6).
  app.addHook('onRequest', async (request) => {
    request.principal = await deps.authenticate(request);
  });
}
