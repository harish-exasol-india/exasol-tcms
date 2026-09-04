import { coverageQuerySchema, coverageResponseSchema, uncoveredResponseSchema } from '@tcms/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Database } from '../../db/client.js';
import {
  type CoverageFilters,
  coverageBySuite,
  coverageByTag,
  coverageSummary,
  uncoveredCases,
} from '../../services/coverage.js';
import { unauthorized } from '../errors.js';

const projectParams = z.object({ projectId: z.string().uuid() });

function filtersFrom(query: z.infer<typeof coverageQuerySchema>): CoverageFilters {
  const tags =
    query.tag === undefined ? undefined : Array.isArray(query.tag) ? query.tag : [query.tag];
  return {
    ...(query.suiteId ? { suiteId: query.suiteId } : {}),
    ...(tags ? { tags } : {}),
    ...(query.release ? { release: query.release } : {}),
    ...(query.customField && query.customFieldValue
      ? { customField: { key: query.customField, value: query.customFieldValue } }
      : {}),
  };
}

export function registerCoverageRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer },
): void {
  const { db, authorizer } = deps;

  async function guard(request: FastifyRequest) {
    const { projectId } = projectParams.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await authorizer.authorize(principal, 'report.read', projectId);
    return projectId;
  }

  app.get('/api/projects/:projectId/coverage', async (request) => {
    const projectId = await guard(request);
    const query = coverageQuerySchema.parse(request.query);
    const filters = filtersFrom(query);

    const summary = await coverageSummary(db, projectId, filters);
    const groups =
      query.groupBy === 'tag'
        ? await coverageByTag(db, projectId, filters)
        : query.groupBy === 'suite'
          ? await coverageBySuite(db, projectId, filters)
          : [];

    return coverageResponseSchema.parse({ summary, groups, groupBy: query.groupBy });
  });

  /** Drill-through: the individual cases behind a coverage gap. */
  app.get('/api/projects/:projectId/coverage/uncovered', async (request) => {
    const projectId = await guard(request);
    const query = coverageQuerySchema.parse(request.query);
    return uncoveredResponseSchema.parse(await uncoveredCases(db, projectId, filtersFrom(query)));
  });
}
