import type { Permission } from '@tcms/shared';
import {
  createEnvironmentRequestSchema,
  createPlanRequestSchema,
  createReleaseRequestSchema,
  environmentListSchema,
  releaseListSchema,
  testPlanListSchema,
  updatePlanRequestSchema,
  updateReleaseRequestSchema,
} from '@tcms/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Database } from '../../db/client.js';
import {
  createEnvironment,
  createPlan,
  createRelease,
  deleteEnvironment,
  deletePlan,
  listEnvironments,
  listPlans,
  listReleases,
  planCaseIds,
  updatePlan,
  updateRelease,
} from '../../services/planning.js';
import { unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });
const idParams = projectParams.extend({ id: z.string().uuid() });

export function registerPlanningRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer },
): void {
  const { db, authorizer } = deps;

  async function guard(request: FastifyRequest, permission: Permission) {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, permission, projectId);
    return { projectId, principal };
  }

  // ---- plans --------------------------------------------------------------------------
  app.get('/api/projects/:projectId/plans', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    return testPlanListSchema.parse({ plans: await listPlans(db, projectId) });
  });

  app.get('/api/projects/:projectId/plans/:id/cases', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    const { id } = idParams.parse(request.params);
    await listPlans(db, projectId);
    return { caseIds: await planCaseIds(db, id) };
  });

  app.post('/api/projects/:projectId/plans', async (request, reply) => {
    const { projectId, principal } = await guard(request, 'plan.manage');
    const body = createPlanRequestSchema.parse(request.body);
    const userId = principal.kind === 'user' ? principal.userId : null;
    const created = await createPlan(db, projectId, userId, body);
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/api/projects/:projectId/plans/:id', async (request) => {
    const { projectId } = await guard(request, 'plan.manage');
    const { id } = idParams.parse(request.params);
    await updatePlan(db, projectId, id, updatePlanRequestSchema.parse(request.body));
    return { ok: true };
  });

  app.delete('/api/projects/:projectId/plans/:id', async (request) => {
    const { projectId } = await guard(request, 'plan.manage');
    const { id } = idParams.parse(request.params);
    await deletePlan(db, projectId, id);
    return { ok: true };
  });

  // ---- environments -------------------------------------------------------------------
  app.get('/api/projects/:projectId/environments', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    return environmentListSchema.parse({ environments: await listEnvironments(db, projectId) });
  });

  app.post('/api/projects/:projectId/environments', async (request, reply) => {
    const { projectId } = await guard(request, 'environment.manage');
    const created = await createEnvironment(
      db,
      projectId,
      createEnvironmentRequestSchema.parse(request.body),
    );
    return reply.status(201).send({ id: created.id });
  });

  app.delete('/api/projects/:projectId/environments/:id', async (request) => {
    const { projectId } = await guard(request, 'environment.manage');
    const { id } = idParams.parse(request.params);
    await deleteEnvironment(db, projectId, id);
    return { ok: true };
  });

  // ---- releases -----------------------------------------------------------------------
  app.get('/api/projects/:projectId/releases', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    return releaseListSchema.parse({ releases: await listReleases(db, projectId) });
  });

  app.post('/api/projects/:projectId/releases', async (request, reply) => {
    const { projectId } = await guard(request, 'release.manage');
    const created = await createRelease(
      db,
      projectId,
      createReleaseRequestSchema.parse(request.body),
    );
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/api/projects/:projectId/releases/:id', async (request) => {
    const { projectId } = await guard(request, 'release.manage');
    const { id } = idParams.parse(request.params);
    await updateRelease(db, projectId, id, updateReleaseRequestSchema.parse(request.body));
    return { ok: true };
  });
}
