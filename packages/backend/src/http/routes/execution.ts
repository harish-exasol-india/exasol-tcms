import {
  createRunRequestSchema,
  linkDefectRequestSchema,
  type Permission,
  recordResultRequestSchema,
  runCaseSchema,
  runDetailSchema,
  runListSchema,
} from '@tcms/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { contextFor } from '../../services/context.js';
import { addAttachment, getAttachment, linkDefect, unlinkDefect } from '../../services/evidence.js';
import {
  closeRun,
  createRun,
  getRun,
  getRunCase,
  listRuns,
  recordResult,
  toRunSummary,
} from '../../services/runs.js';
import type { ObjectStore } from '../../services/storage.js';
import { badRequest, unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });
const runParams = projectParams.extend({ runId: z.string().uuid() });
const runCaseParams = runParams.extend({ runCaseId: z.string().uuid() });

export function registerExecutionRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer; store: ObjectStore; config: Config },
): void {
  const { db, authorizer, store, config } = deps;

  async function guard(request: FastifyRequest, permission: Permission) {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, permission, projectId);
    return { projectId, principal, ctx: contextFor(principal) };
  }

  app.get('/api/projects/:projectId/runs', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    const query = z
      .object({
        releaseId: z.string().uuid().optional(),
        kind: z.string().optional(),
        status: z.string().optional(),
      })
      .parse(request.query);
    const rows = await listRuns(db, projectId, query);
    return runListSchema.parse({ runs: rows.map(toRunSummary) });
  });

  app.post('/api/projects/:projectId/runs', async (request, reply) => {
    const { projectId, ctx } = await guard(request, 'run.create');
    const body = createRunRequestSchema.parse(request.body);
    const run = await createRun(db, ctx, projectId, body);
    return reply.status(201).send({ id: run.id });
  });

  app.get('/api/projects/:projectId/runs/:runId', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    const { runId } = runParams.parse(request.params);
    return runDetailSchema.parse(await getRun(db, projectId, runId));
  });

  app.post('/api/projects/:projectId/runs/:runId/close', async (request) => {
    const { projectId, ctx } = await guard(request, 'run.close');
    const { runId } = runParams.parse(request.params);
    await closeRun(db, ctx, projectId, runId);
    return { ok: true };
  });

  app.get('/api/projects/:projectId/runs/:runId/cases/:runCaseId', async (request) => {
    const { projectId } = await guard(request, 'run.read');
    const { runId, runCaseId } = runCaseParams.parse(request.params);
    return runCaseSchema.parse(await getRunCase(db, projectId, runId, runCaseId));
  });

  /** Records a result under optimistic concurrency; a stale write returns 409. */
  app.patch('/api/projects/:projectId/runs/:runId/cases/:runCaseId', async (request) => {
    const { projectId, ctx } = await guard(request, 'run.execute');
    const { runId, runCaseId } = runCaseParams.parse(request.params);
    const body = recordResultRequestSchema.parse(request.body);
    return recordResult(db, ctx, projectId, runId, runCaseId, body);
  });

  // ---- evidence -----------------------------------------------------------------------
  app.post(
    '/api/projects/:projectId/runs/:runId/cases/:runCaseId/attachments',
    async (request, reply) => {
      const { projectId, ctx } = await guard(request, 'run.execute');
      const { runId, runCaseId } = runCaseParams.parse(request.params);

      const file = await request.file({ limits: { fileSize: config.ATTACHMENT_MAX_BYTES } });
      if (!file) throw badRequest('No file was uploaded');
      const body = await file.toBuffer().catch(() => {
        // @fastify/multipart throws once the limit is exceeded mid-stream.
        throw badRequest(
          `File exceeds the ${Math.round(config.ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB limit`,
          'FILE_TOO_LARGE',
        );
      });

      const stepPosition = file.fields['stepPosition'];
      const parsedStep =
        stepPosition && 'value' in stepPosition ? Number(stepPosition.value) : null;

      const attachment = await addAttachment(db, store, ctx, {
        projectId,
        runId,
        runCaseId,
        stepPosition: Number.isFinite(parsedStep) ? parsedStep : null,
        filename: file.filename,
        contentType: file.mimetype,
        body,
        maxBytes: config.ATTACHMENT_MAX_BYTES,
      });
      return reply.status(201).send({ id: attachment.id, filename: attachment.filename });
    },
  );

  app.get('/api/projects/:projectId/attachments/:attachmentId', async (request, reply) => {
    const { projectId } = await guard(request, 'run.read');
    const { attachmentId } = projectParams
      .extend({ attachmentId: z.string().uuid() })
      .parse(request.params);
    const meta = await getAttachment(db, projectId, attachmentId);
    const stream = await store.get(meta.objectKey);
    return reply
      .header('content-type', meta.contentType)
      .header('content-disposition', `inline; filename="${meta.filename}"`)
      .send(stream);
  });

  // ---- defects ------------------------------------------------------------------------
  app.post(
    '/api/projects/:projectId/runs/:runId/cases/:runCaseId/defects',
    async (request, reply) => {
      const { projectId, ctx } = await guard(request, 'defect.link');
      const { runId, runCaseId } = runCaseParams.parse(request.params);
      const body = linkDefectRequestSchema.parse(request.body);
      const link = await linkDefect(db, ctx, {
        projectId,
        runId,
        runCaseId,
        issueKey: body.issueKey,
        stepPosition: body.stepPosition ?? null,
        keyPattern: config.JIRA_KEY_PATTERN,
      });
      return reply.status(201).send({
        id: link?.id,
        issueKey: link?.issueKey,
        url: `${config.JIRA_BASE_URL}/browse/${link?.issueKey}`,
      });
    },
  );

  app.delete('/api/projects/:projectId/defects/:defectLinkId', async (request) => {
    const { projectId } = await guard(request, 'defect.link');
    const { defectLinkId } = projectParams
      .extend({ defectLinkId: z.string().uuid() })
      .parse(request.params);
    await unlinkDefect(db, projectId, defectLinkId);
    return { ok: true };
  });
}
