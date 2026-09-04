import {
  metricsQuerySchema,
  metricsSchema,
  type Permission,
  releaseReadinessSchema,
  signOffItemRequestSchema,
  triageListSchema,
  updateTriageRequestSchema,
} from '@tcms/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { contextFor } from '../../services/context.js';
import { metrics } from '../../services/metrics.js';
import {
  addSignOffItem,
  completeSignOff,
  releaseReadiness,
  reopenSignOff,
} from '../../services/release-readiness.js';
import { listTriage, runTriageSummary, updateTriage } from '../../services/triage.js';
import { unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });

export function registerReportingRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer; config: Config },
): void {
  const { db, authorizer, config } = deps;

  async function guard(request: FastifyRequest, permission: Permission) {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, permission, projectId);
    return { projectId, principal, ctx: contextFor(principal) };
  }

  // ---- triage -------------------------------------------------------------------------
  app.get('/api/projects/:projectId/triage', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    const query = z
      .object({ state: z.string().optional(), runId: z.string().uuid().optional() })
      .parse(request.query);
    return triageListSchema.parse(await listTriage(db, projectId, query));
  });

  app.patch('/api/projects/:projectId/triage/:triageId', async (request) => {
    const { projectId, ctx } = await guard(request, 'triage.update');
    const { triageId } = projectParams
      .extend({ triageId: z.string().uuid() })
      .parse(request.params);
    await updateTriage(db, ctx, projectId, triageId, updateTriageRequestSchema.parse(request.body));
    return { ok: true };
  });

  app.get('/api/projects/:projectId/runs/:runId/triage-summary', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    const { runId } = projectParams.extend({ runId: z.string().uuid() }).parse(request.params);
    return runTriageSummary(db, projectId, runId);
  });

  // ---- release readiness ---------------------------------------------------------------
  app.get('/api/projects/:projectId/releases/:releaseId/readiness', async (request) => {
    const { projectId } = await guard(request, 'report.read');
    const { releaseId } = projectParams
      .extend({ releaseId: z.string().uuid() })
      .parse(request.params);
    return releaseReadinessSchema.parse(
      await releaseReadiness(db, projectId, releaseId, config.JIRA_BASE_URL),
    );
  });

  app.post('/api/projects/:projectId/releases/:releaseId/sign-offs', async (request, reply) => {
    const { projectId } = await guard(request, 'release.manage');
    const { releaseId } = projectParams
      .extend({ releaseId: z.string().uuid() })
      .parse(request.params);
    const created = await addSignOffItem(
      db,
      projectId,
      releaseId,
      signOffItemRequestSchema.parse(request.body),
    );
    return reply.status(201).send({ id: created.id });
  });

  app.post('/api/projects/:projectId/sign-offs/:signOffId/complete', async (request) => {
    const { projectId, ctx } = await guard(request, 'release.sign_off');
    const { signOffId } = projectParams
      .extend({ signOffId: z.string().uuid() })
      .parse(request.params);
    await completeSignOff(db, ctx, projectId, signOffId);
    return { ok: true };
  });

  app.post('/api/projects/:projectId/sign-offs/:signOffId/reopen', async (request) => {
    const { projectId } = await guard(request, 'release.manage');
    const { signOffId } = projectParams
      .extend({ signOffId: z.string().uuid() })
      .parse(request.params);
    await reopenSignOff(db, projectId, signOffId);
    return { ok: true };
  });

  // ---- metrics -------------------------------------------------------------------------
  app.get('/api/projects/:projectId/metrics', async (request) => {
    const { projectId } = await guard(request, 'report.read');
    const query = metricsQuerySchema.parse(request.query);
    return metricsSchema.parse(
      await metrics(db, projectId, {
        days: query.days,
        ...(query.releaseId ? { releaseId: query.releaseId } : {}),
        retentionMonths: config.RETENTION_MONTHS,
      }),
    );
  });
}
