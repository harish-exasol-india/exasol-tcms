import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AccessDeniedError } from '../auth/authorization.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
    /**
     * Extra fields merged into the response body. A conflict must carry the value that
     * actually won, not merely a code — otherwise the caller cannot reconcile.
     */
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string, code?: string) => new HttpError(400, m, code);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string, code?: string) => new HttpError(409, m, code);
export const payloadTooLarge = (m: string) => new HttpError(413, m);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AccessDeniedError) {
      // Undifferentiated: a caller must not learn that a project exists by being denied.
      return reply.status(404).send({ error: 'Not found' });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.detail ?? {}),
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: (error as { validation: unknown }).validation,
      });
    }
    // Postgres unique-violation (23505). A duplicate is something the caller can fix, so it
    // is reported as a conflict rather than as a server fault. Routes that can produce a
    // duplicate should still check explicitly, to give a message naming the field; this is
    // the net for the ones that do not.
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    const pgCode = (error as { code?: string }).code ?? cause?.code ?? undefined;
    if (pgCode === '23505') {
      const constraint = (error as { constraint?: string }).constraint ?? cause?.constraint;
      request.log.warn({ constraint }, 'unique violation surfaced to the caller');
      return reply.status(409).send({
        error: 'That value already exists',
        code: 'DUPLICATE',
        ...(constraint ? { constraint } : {}),
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: 'Internal server error' });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: 'Not found' }));
}
