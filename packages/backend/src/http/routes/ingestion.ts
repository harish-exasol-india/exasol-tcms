import { bindingReportSchema, ingestMetadataSchema, ingestResponseSchema } from '@tcms/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { bindingReport } from '../../ingestion/bindings.js';
import { ingestJUnitReport } from '../../ingestion/ingest.js';
import { JUnitParseError } from '../../ingestion/junit.js';
import { contextFor } from '../../services/context.js';
import { badRequest, unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });

export function registerIngestionRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer; config: Config },
): void {
  const { db, authorizer, config } = deps;

  /**
   * Headless result upload (AC 2, AC 6).
   *
   * Accepts the raw XML as the request body with metadata in the query string, so a CI job
   * integrates with a single curl and no client library. The run is created automatically;
   * there is no approval or reconciliation step.
   */
  app.post(
    '/api/projects/:projectId/results/junit',
    {
      // Reports from a large suite are big; the default 1MB body limit is too small.
      bodyLimit: 32 * 1024 * 1024,
      config: {},
    },
    async (request: FastifyRequest, reply) => {
      const { projectId } = projectParams.parse(request.params);
      const principal = request.principal;
      if (!principal) throw unauthorized();
      await authorizer.authorize(principal, 'run.create', projectId);

      const metadata = ingestMetadataSchema.parse(request.query);
      const xml = typeof request.body === 'string' ? request.body : '';

      try {
        const result = await ingestJUnitReport(db, contextFor(principal), projectId, xml, metadata);
        return reply.status(201).send(ingestResponseSchema.parse(result));
      } catch (error) {
        // A malformed report is the caller's problem, not a server fault, and nothing has
        // been persisted because parsing happens before any write.
        if (error instanceof JUnitParseError) throw badRequest(error.message, 'INVALID_REPORT');
        throw error;
      }
    },
  );

  /** Binding health: how tests map to cases, and where that mapping is decaying. */
  app.get('/api/projects/:projectId/automation/bindings', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, 'report.read', projectId);

    const query = z
      .object({
        filter: z.enum(['all', 'fragile', 'stale']).default('all'),
        limit: z.coerce.number().int().min(1).max(1000).default(300),
      })
      .parse(request.query);

    const report = await bindingReport(db, projectId, config.BINDING_STALE_DAYS, query);
    return bindingReportSchema.parse(report);
  });
}
