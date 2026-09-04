/**
 * MCP tool definitions (AC 8, design Decision 10).
 *
 * Every tool resolves the caller's per-project role through the same `authorize` function
 * the REST API and the web interface use. There is deliberately no second permission path:
 * a change to the role matrix takes effect here simultaneously, because it is the same
 * matrix, not a mirror of it.
 *
 * Writes are recorded with `origin: 'mcp'`, so agent-authored content is filterable and
 * auditable — provenance rather than prevention (Decision 10).
 */
import type { Permission } from '@tcms/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Authorizer, Principal } from '../auth/authorization.js';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { bindingReport } from '../ingestion/bindings.js';
import { createCase, getCase, listCases, updateCase } from '../services/cases.js';
import { contextFor } from '../services/context.js';
import { coverageByTag, coverageSummary } from '../services/coverage.js';
import { linkDefect } from '../services/evidence.js';
import { metrics } from '../services/metrics.js';
import { releaseReadiness } from '../services/release-readiness.js';
import { createRun, getRun, listRuns, recordResult, toRunSummary } from '../services/runs.js';
import { listSuites } from '../services/suites.js';
import { listTriage, updateTriage } from '../services/triage.js';

export type McpDeps = {
  db: Database;
  authorizer: Authorizer;
  config: {
    JIRA_BASE_URL: string;
    JIRA_KEY_PATTERN: string;
    RETENTION_MONTHS: number;
    BINDING_STALE_DAYS: number;
  };
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** The permission the caller must hold in the target project. */
  permission: Permission;
  handler: (args: Record<string, unknown>, principal: Principal, deps: McpDeps) => Promise<unknown>;
};

// Accepts either the project id or its human-readable key: an agent that has just read
// `list_projects` has both, and requiring the uuid makes every call need a lookup first.
const projectArg = {
  projectId: z
    .string()
    .min(1)
    .describe('The project to act within, given as its id or its key (e.g. "exasol-db")'),
};

/** Resolves the project key to an id, so agents can use the human-readable key. */
async function resolveProject(db: Database, projectIdOrKey: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(projectIdOrKey)) return projectIdOrKey;
  const [row] = await db.select().from(s.projects).where(eq(s.projects.key, projectIdOrKey));
  if (!row) throw new Error(`No project with key '${projectIdOrKey}'`);
  return row.id;
}

export const TOOLS: ToolDefinition[] = [
  // ---- read ---------------------------------------------------------------------------
  {
    name: 'list_projects',
    description: 'List the projects the caller holds a role in.',
    inputSchema: z.object({}),
    permission: 'case.read',
    handler: async (_args, principal, { db, authorizer }) => {
      if (principal.kind !== 'user') return { projects: [] };
      const ids = await authorizer.visibleProjectIds(principal.userId);
      if (ids.length === 0) return { projects: [] };
      const rows = await db.select().from(s.projects);
      return {
        projects: rows
          .filter((p) => ids.includes(p.id))
          .map((p) => ({ id: p.id, key: p.key, name: p.name })),
      };
    },
  },
  {
    name: 'list_suites',
    description: 'The suite tree of a project, with per-suite case counts.',
    inputSchema: z.object(projectArg),
    permission: 'case.read',
    handler: async (args, _p, { db }) => ({
      suites: await listSuites(db, await resolveProject(db, String(args['projectId']))),
    }),
  },
  {
    name: 'search_cases',
    description:
      'Search managed test cases by title or reference, optionally filtered by suite, tag, or automation status.',
    inputSchema: z.object({
      ...projectArg,
      search: z.string().optional().describe('Match against title or reference'),
      suiteId: z.string().uuid().optional(),
      tag: z.string().optional(),
      automated: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    permission: 'case.read',
    handler: async (args, _p, { db }) =>
      listCases(db, await resolveProject(db, String(args['projectId'])), {
        ...(args['search'] ? { search: String(args['search']) } : {}),
        ...(args['suiteId'] ? { suiteId: String(args['suiteId']) } : {}),
        ...(args['tag'] ? { tags: [String(args['tag'])] } : {}),
        ...(typeof args['automated'] === 'boolean' ? { automated: args['automated'] } : {}),
        limit: Number(args['limit'] ?? 50),
      }),
  },
  {
    name: 'get_case',
    description: 'One managed test case with its steps, tags, and metadata.',
    inputSchema: z.object({ ...projectArg, caseId: z.string().uuid() }),
    permission: 'case.read',
    handler: async (args, _p, { db }) =>
      getCase(db, await resolveProject(db, String(args['projectId'])), String(args['caseId'])),
  },
  {
    name: 'get_coverage',
    description:
      'Automation coverage: how many managed cases have an automated test bound, how many remain manual, and how many have never been executed. Cannot report features that have no test case at all.',
    inputSchema: z.object({
      ...projectArg,
      release: z.string().optional(),
      groupByTag: z.boolean().default(false),
    }),
    permission: 'report.read',
    handler: async (args, _p, { db }) => {
      const projectId = await resolveProject(db, String(args['projectId']));
      const filters = args['release'] ? { release: String(args['release']) } : {};
      return {
        summary: await coverageSummary(db, projectId, filters),
        ...(args['groupByTag'] ? { byTag: await coverageByTag(db, projectId, filters) } : {}),
      };
    },
  },
  {
    name: 'list_runs',
    description: 'Test runs in a project, newest first, with execution progress.',
    inputSchema: z.object({ ...projectArg, releaseId: z.string().uuid().optional() }),
    permission: 'run.read',
    handler: async (args, _p, { db }) => {
      const rows = await listRuns(db, await resolveProject(db, String(args['projectId'])), {
        ...(args['releaseId'] ? { releaseId: String(args['releaseId']) } : {}),
      });
      return { runs: rows.map(toRunSummary) };
    },
  },
  {
    name: 'get_run',
    description: 'One run with its cases and their current outcomes.',
    inputSchema: z.object({ ...projectArg, runId: z.string().uuid() }),
    permission: 'run.read',
    handler: async (args, _p, { db }) =>
      getRun(db, await resolveProject(db, String(args['projectId'])), String(args['runId'])),
  },
  {
    name: 'get_failure_triage',
    description:
      'Failures and their triage state. A failure matching a previously triaged signature inherits that state automatically.',
    inputSchema: z.object({ ...projectArg, state: z.string().optional() }),
    permission: 'run.read',
    handler: async (args, _p, { db }) =>
      listTriage(db, await resolveProject(db, String(args['projectId'])), {
        ...(args['state'] ? { state: String(args['state']) } : {}),
      }),
  },
  {
    name: 'get_release_readiness',
    description:
      'Everything a go/no-go discussion needs for one release: execution progress, blocking failures, linked defects, coverage, UAT status, and sign-off gate.',
    inputSchema: z.object({ ...projectArg, releaseId: z.string().uuid() }),
    permission: 'report.read',
    handler: async (args, _p, { db, config }) =>
      releaseReadiness(
        db,
        await resolveProject(db, String(args['projectId'])),
        String(args['releaseId']),
        config.JIRA_BASE_URL,
      ),
  },
  {
    name: 'get_metrics',
    description:
      'Quality metrics: pass rate, failure rate, runtime, coverage, flaky candidates, and defect age bands, bounded by the retention window.',
    inputSchema: z.object({ ...projectArg, days: z.number().int().min(1).max(400).default(90) }),
    permission: 'report.read',
    handler: async (args, _p, { db, config }) =>
      metrics(db, await resolveProject(db, String(args['projectId'])), {
        days: Number(args['days'] ?? 90),
        retentionMonths: config.RETENTION_MONTHS,
      }),
  },
  {
    name: 'get_automation_bindings',
    description:
      'How automated tests map to managed cases, including which bindings are name-based (fragile) and which have gone stale.',
    inputSchema: z.object(projectArg),
    permission: 'report.read',
    handler: async (args, _p, { db, config }) =>
      bindingReport(
        db,
        await resolveProject(db, String(args['projectId'])),
        config.BINDING_STALE_DAYS,
      ),
  },

  // ---- write --------------------------------------------------------------------------
  {
    name: 'create_case',
    description:
      'Create a managed test case. Recorded with MCP provenance, so agent-authored cases are distinguishable from human-authored ones.',
    inputSchema: z.object({
      ...projectArg,
      suiteId: z.string().uuid(),
      title: z.string().min(1),
      priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      risk: z.enum(['low', 'medium', 'high']).default('medium'),
      preconditions: z.string().optional(),
      steps: z
        .array(z.object({ action: z.string().min(1), expected: z.string().optional() }))
        .min(1)
        .describe('At least one step is required'),
      tags: z.array(z.string()).default([]),
    }),
    permission: 'case.create',
    handler: async (args, principal, { db }) => {
      const projectId = await resolveProject(db, String(args['projectId']));
      const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
      if (!project) throw new Error('Project not found');
      return createCase(db, contextFor(principal), projectId, project.key, {
        suiteId: String(args['suiteId']),
        title: String(args['title']),
        priority: args['priority'] as never,
        risk: args['risk'] as never,
        preconditions: (args['preconditions'] as string | undefined) ?? null,
        steps: args['steps'] as never,
        tags: (args['tags'] as string[]) ?? [],
      });
    },
  },
  {
    name: 'update_case',
    description: 'Update a managed test case. Records a change history entry with MCP provenance.',
    inputSchema: z.object({
      ...projectArg,
      caseId: z.string().uuid(),
      title: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      risk: z.enum(['low', 'medium', 'high']).optional(),
      tags: z.array(z.string()).optional(),
    }),
    permission: 'case.edit',
    handler: async (args, principal, { db }) =>
      updateCase(
        db,
        contextFor(principal),
        await resolveProject(db, String(args['projectId'])),
        String(args['caseId']),
        {
          ...(args['title'] ? { title: String(args['title']) } : {}),
          ...(args['priority'] ? { priority: args['priority'] as never } : {}),
          ...(args['risk'] ? { risk: args['risk'] as never } : {}),
          ...(args['tags'] ? { tags: args['tags'] as string[] } : {}),
        },
      ),
  },
  {
    name: 'create_run',
    description: 'Create a test run from a plan or an explicit case selection.',
    inputSchema: z.object({
      ...projectArg,
      name: z.string().min(1),
      kind: z.enum(['manual', 'automated', 'uat']).default('manual'),
      planId: z.string().uuid().optional(),
      caseIds: z.array(z.string().uuid()).optional(),
      releaseId: z.string().uuid().optional(),
    }),
    permission: 'run.create',
    handler: async (args, principal, { db }) =>
      createRun(db, contextFor(principal), await resolveProject(db, String(args['projectId'])), {
        name: String(args['name']),
        kind: args['kind'] as never,
        ...(args['planId'] ? { planId: String(args['planId']) } : {}),
        ...(args['caseIds'] ? { caseIds: args['caseIds'] as string[] } : {}),
        ...(args['releaseId'] ? { releaseId: String(args['releaseId']) } : {}),
      }),
  },
  {
    name: 'record_result',
    description:
      'Record an outcome for a case within a run. Requires the version last read, so a concurrent write is rejected rather than silently overwritten.',
    inputSchema: z.object({
      ...projectArg,
      runId: z.string().uuid(),
      runCaseId: z.string().uuid(),
      outcome: z.enum(['passed', 'failed', 'blocked', 'skipped', 'untested']),
      basedOnVersion: z.number().int().min(0),
      comment: z.string().optional(),
    }),
    permission: 'run.execute',
    handler: async (args, principal, { db }) =>
      recordResult(
        db,
        contextFor(principal),
        await resolveProject(db, String(args['projectId'])),
        String(args['runId']),
        String(args['runCaseId']),
        {
          outcome: args['outcome'] as never,
          basedOnVersion: Number(args['basedOnVersion']),
          ...(args['comment'] ? { comment: String(args['comment']) } : {}),
        },
      ),
  },
  {
    name: 'update_triage',
    description:
      'Set the triage state of a failure signature. The state carries forward automatically to later matching failures.',
    inputSchema: z.object({
      ...projectArg,
      triageId: z.string().uuid(),
      state: z.enum(['new', 'investigating', 'known_issue', 'flaky', 'resolved', 'regression']),
      note: z.string().optional(),
    }),
    permission: 'triage.update',
    handler: async (args, principal, { db }) =>
      updateTriage(
        db,
        contextFor(principal),
        await resolveProject(db, String(args['projectId'])),
        String(args['triageId']),
        {
          state: args['state'] as never,
          ...(args['note'] ? { note: String(args['note']) } : {}),
        },
      ),
  },
  {
    name: 'link_defect',
    description:
      'Link a Jira issue to a failed case in a run. The link is a reference only; Jira is never called.',
    inputSchema: z.object({
      ...projectArg,
      runId: z.string().uuid(),
      runCaseId: z.string().uuid(),
      issueKey: z.string().min(1),
      stepPosition: z.number().int().positive().optional(),
    }),
    permission: 'defect.link',
    handler: async (args, principal, { db, config }) =>
      linkDefect(db, contextFor(principal), {
        projectId: await resolveProject(db, String(args['projectId'])),
        runId: String(args['runId']),
        runCaseId: String(args['runCaseId']),
        issueKey: String(args['issueKey']),
        stepPosition: (args['stepPosition'] as number | undefined) ?? null,
        keyPattern: config.JIRA_KEY_PATTERN,
      }),
  },
];
