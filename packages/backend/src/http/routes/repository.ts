import type { Permission } from '@tcms/shared';
import {
  caseHistoryResponseSchema,
  caseListQuerySchema,
  caseListResponseSchema,
  createCaseRequestSchema,
  createCustomFieldRequestSchema,
  createSharedStepRequestSchema,
  createSuiteRequestSchema,
  customFieldListSchema,
  sharedStepListSchema,
  suiteTreeSchema,
  tagListSchema,
  testCaseSchema,
  updateCaseRequestSchema,
  updateSharedStepRequestSchema,
  updateSuiteRequestSchema,
} from '@tcms/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Database } from '../../db/client.js';
import * as s from '../../db/schema/index.js';
import {
  createCustomField,
  createSharedStep,
  customFieldUsage,
  deleteCustomField,
  deleteSharedStep,
  getSharedStep,
  listCustomFields,
  listSharedSteps,
  updateSharedStep,
} from '../../services/authoring.js';
import { createCase, deleteCase, getCase, listCases, updateCase } from '../../services/cases.js';
import { contextFor } from '../../services/context.js';
import { listCaseHistory } from '../../services/history.js';
import { createSuite, deleteSuite, listSuites, updateSuite } from '../../services/suites.js';
import { listTags } from '../../services/tags.js';
import { notFound, unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });
const caseParams = projectParams.extend({ caseId: z.string().uuid() });
const idParams = projectParams.extend({ id: z.string().uuid() });

export function registerRepositoryRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer },
): void {
  const { db, authorizer } = deps;

  /** Resolves the project and enforces the permission in one place for every route below. */
  async function guard(request: FastifyRequest, permission: Permission) {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, permission, projectId);
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
    if (!project) throw notFound('Project not found');
    return { projectId, project, principal, ctx: contextFor(principal) };
  }

  // ---- suites -------------------------------------------------------------------------
  app.get('/api/projects/:projectId/suites', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    return suiteTreeSchema.parse({ suites: await listSuites(db, projectId) });
  });

  app.post('/api/projects/:projectId/suites', async (request, reply) => {
    const { projectId } = await guard(request, 'suite.manage');
    const body = createSuiteRequestSchema.parse(request.body);
    const created = await createSuite(db, projectId, body);
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/api/projects/:projectId/suites/:id', async (request) => {
    const { projectId } = await guard(request, 'suite.manage');
    const { id } = idParams.parse(request.params);
    const body = updateSuiteRequestSchema.parse(request.body);
    await updateSuite(db, projectId, id, body);
    return { ok: true };
  });

  app.delete('/api/projects/:projectId/suites/:id', async (request) => {
    const { projectId } = await guard(request, 'suite.manage');
    const { id } = idParams.parse(request.params);
    await deleteSuite(db, projectId, id);
    return { ok: true };
  });

  // ---- cases --------------------------------------------------------------------------
  app.get('/api/projects/:projectId/cases', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    const query = caseListQuerySchema.parse(request.query);
    const tags =
      query.tag === undefined ? undefined : Array.isArray(query.tag) ? query.tag : [query.tag];
    const result = await listCases(db, projectId, {
      ...(query.suiteId ? { suiteId: query.suiteId } : {}),
      includeDescendants: query.includeDescendants,
      ...(tags ? { tags } : {}),
      ...(query.automated ? { automated: query.automated === 'true' } : {}),
      ...(query.search ? { search: query.search } : {}),
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return caseListResponseSchema.parse(result);
  });

  app.get('/api/projects/:projectId/cases/:caseId', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    const { caseId } = caseParams.parse(request.params);
    return testCaseSchema.parse(await getCase(db, projectId, caseId));
  });

  app.post('/api/projects/:projectId/cases', async (request, reply) => {
    const { projectId, project, ctx } = await guard(request, 'case.create');
    const body = createCaseRequestSchema.parse(request.body);
    const created = await createCase(db, ctx, projectId, project.key, body);
    return reply.status(201).send(testCaseSchema.parse(created));
  });

  app.patch('/api/projects/:projectId/cases/:caseId', async (request) => {
    const { projectId, ctx } = await guard(request, 'case.edit');
    const { caseId } = caseParams.parse(request.params);
    const body = updateCaseRequestSchema.parse(request.body);
    return testCaseSchema.parse(await updateCase(db, ctx, projectId, caseId, body));
  });

  app.delete('/api/projects/:projectId/cases/:caseId', async (request) => {
    const { projectId, ctx } = await guard(request, 'case.delete');
    const { caseId } = caseParams.parse(request.params);
    await deleteCase(db, ctx, projectId, caseId);
    return { ok: true };
  });

  app.get('/api/projects/:projectId/cases/:caseId/history', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    const { caseId } = caseParams.parse(request.params);
    await getCase(db, projectId, caseId);
    const entries = await listCaseHistory(db, caseId);
    return caseHistoryResponseSchema.parse({
      entries: entries.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
    });
  });

  // ---- tags ---------------------------------------------------------------------------
  app.get('/api/projects/:projectId/tags', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    const { prefix } = z.object({ prefix: z.string().optional() }).parse(request.query);
    return tagListSchema.parse({ tags: await listTags(db, projectId, prefix) });
  });

  // ---- shared steps -------------------------------------------------------------------
  app.get('/api/projects/:projectId/shared-steps', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    return sharedStepListSchema.parse({ sharedSteps: await listSharedSteps(db, projectId) });
  });

  app.get('/api/projects/:projectId/shared-steps/:id', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    const { id } = idParams.parse(request.params);
    return getSharedStep(db, projectId, id);
  });

  app.post('/api/projects/:projectId/shared-steps', async (request, reply) => {
    const { projectId } = await guard(request, 'shared_step.manage');
    const body = createSharedStepRequestSchema.parse(request.body);
    return reply.status(201).send(await createSharedStep(db, projectId, body));
  });

  app.patch('/api/projects/:projectId/shared-steps/:id', async (request) => {
    const { projectId } = await guard(request, 'shared_step.manage');
    const { id } = idParams.parse(request.params);
    const body = updateSharedStepRequestSchema.parse(request.body);
    return updateSharedStep(db, projectId, id, body);
  });

  app.delete('/api/projects/:projectId/shared-steps/:id', async (request) => {
    const { projectId } = await guard(request, 'shared_step.manage');
    const { id } = idParams.parse(request.params);
    await deleteSharedStep(db, projectId, id);
    return { ok: true };
  });

  // ---- custom fields ------------------------------------------------------------------
  app.get('/api/projects/:projectId/custom-fields', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    return customFieldListSchema.parse({ customFields: await listCustomFields(db, projectId) });
  });

  app.post('/api/projects/:projectId/custom-fields', async (request, reply) => {
    const { projectId } = await guard(request, 'custom_field.manage');
    const body = createCustomFieldRequestSchema.parse(request.body);
    return reply.status(201).send(await createCustomField(db, projectId, body));
  });

  /** Reports impact before removal, so the caller can warn (test-repository spec). */
  app.get('/api/projects/:projectId/custom-fields/:id/usage', async (request) => {
    const { projectId } = await guard(request, 'case.read');
    const { id } = idParams.parse(request.params);
    return customFieldUsage(db, projectId, id);
  });

  app.delete('/api/projects/:projectId/custom-fields/:id', async (request) => {
    const { projectId } = await guard(request, 'custom_field.manage');
    const { id } = idParams.parse(request.params);
    await deleteCustomField(db, projectId, id);
    return { ok: true };
  });
}
