import { Readable } from 'node:stream';
import type { Permission } from '@tcms/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import {
  csvRow,
  exportCases,
  pageResults,
  resultCsvHeader,
  resultToCsv,
  streamResults,
} from '../../services/export.js';
import { applyRetention, orphanedAttachmentCount } from '../../services/retention.js';
import type { ObjectStore } from '../../services/storage.js';
import { unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });

const exportQuery = z.object({
  releaseId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(['csv', 'json']).default('csv'),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional(),
});

export function registerLifecycleRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer; store: ObjectStore; config: Config },
): void {
  const { db, authorizer, store, config } = deps;

  async function guard(request: FastifyRequest, permission: Permission) {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, permission, projectId);
    return projectId;
  }

  /** Retention policy, so the window in force is discoverable rather than folklore. */
  app.get('/api/retention', async () => ({
    retentionMonths: config.RETENTION_MONTHS,
    appliesTo: 'execution history: runs, results, step results, defect links, attachments',
    excludes: 'managed test assets: cases, suites, shared steps, plans, and their history',
  }));

  /**
   * Streaming export.
   *
   * Rows are pushed as they arrive from the database rather than assembled in memory, so a
   * full-window export does not scale with heap.
   */
  app.get('/api/projects/:projectId/export/results', async (request, reply) => {
    const projectId = await guard(request, 'export.perform');
    const query = exportQuery.parse(request.query);
    const filters = {
      ...(query.releaseId ? { releaseId: query.releaseId } : {}),
      ...(query.environmentId ? { environmentId: query.environmentId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const stream = Readable.from(
      (async function* () {
        if (query.format === 'csv') {
          yield resultCsvHeader;
          for await (const batch of streamResults(db, projectId, filters)) {
            for (const row of batch) yield resultToCsv(row);
          }
        } else {
          // Newline-delimited JSON: streamable, and each line is independently parseable.
          for await (const batch of streamResults(db, projectId, filters)) {
            for (const row of batch) yield `${JSON.stringify(row)}\n`;
          }
        }
      })(),
    );

    return reply
      .header(
        'content-type',
        query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
      )
      .header(
        'content-disposition',
        `attachment; filename="tcms-results-${stamp}.${query.format === 'csv' ? 'csv' : 'ndjson'}"`,
      )
      .send(stream);
  });

  app.get('/api/projects/:projectId/export/cases', async (request, reply) => {
    const projectId = await guard(request, 'export.perform');
    const rows = await exportCases(db, projectId);
    const stamp = new Date().toISOString().slice(0, 10);
    const header = csvRow([
      'ref',
      'title',
      'suite',
      'priority',
      'risk',
      'owner',
      'automated',
      'preconditions',
      'tags',
    ]);
    const body = rows
      .map((r) =>
        csvRow([
          r.ref,
          r.title,
          r.suite,
          r.priority,
          r.risk,
          r.owner,
          r.automated,
          r.preconditions,
          r.tags,
        ]),
      )
      .join('');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="tcms-cases-${stamp}.csv"`)
      .send(header + body);
  });

  /** Paginated programmatic access. */
  app.get('/api/projects/:projectId/results', async (request) => {
    const projectId = await guard(request, 'report.read');
    const query = exportQuery.parse(request.query);
    return pageResults(db, projectId, {
      ...(query.releaseId ? { releaseId: query.releaseId } : {}),
      ...(query.environmentId ? { environmentId: query.environmentId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });

  /** Retention run. Administrators only; supports a dry run for the operator runbook. */
  app.post('/api/admin/retention', async (request) => {
    const principal = request.principal;
    if (principal?.kind !== 'user') throw unauthorized();

    const projects = await authorizer.visibleProjectIds(principal.userId);
    const admin = await Promise.all(
      projects.map((p) => authorizer.can(principal, 'project.settings', p)),
    );
    if (!admin.some(Boolean)) throw unauthorized('Administrator access required');

    const body = z.object({ dryRun: z.boolean().default(true) }).parse(request.body ?? {});
    const report = await applyRetention(db, store, {
      retentionMonths: config.RETENTION_MONTHS,
      dryRun: body.dryRun,
    });
    return { ...report, orphanedAttachments: await orphanedAttachmentCount(db) };
  });
}
