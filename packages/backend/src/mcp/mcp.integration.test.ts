import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('MCP integration', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  let otherProjectId: string;
  let suiteId: string;
  const cookies: Record<string, string> = {};

  const rpc = async (who: string, method: string, params?: Record<string, unknown>) => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method, params },
      cookies: { tcms_session: cookies[who] as string },
    });
    return { status: response.statusCode, body: response.json() };
  };

  const call = async (who: string, name: string, args: Record<string, unknown> = {}) => {
    const { body } = await rpc(who, 'tools/call', { name, arguments: args });
    return body.result;
  };

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `mcp${stamp}`, name: 'MCP' })
      .returning();
    projectId = p!.id;
    const [o] = await db
      .insert(s.projects)
      .values({ key: `mcpother${stamp}`, name: 'Other' })
      .returning();
    otherProjectId = o!.id;

    for (const role of ['lead', 'viewer', 'outsider'] as const) {
      const [u] = await db
        .insert(s.users)
        .values({
          email: `${role}-mcp-${stamp}@exasol.com`,
          displayName: role,
          passwordHash: await hashPassword('pw'),
        })
        .returning();
      if (role !== 'outsider') {
        await db.insert(s.memberships).values({ userId: u!.id, projectId, role });
      } else {
        await db
          .insert(s.memberships)
          .values({ userId: u!.id, projectId: otherProjectId, role: 'admin' });
      }
    }

    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    suiteId = suiteRow!.id;
    await db
      .insert(s.testCases)
      .values({ projectId, suiteId, ref: 'MCP-1', title: 'Existing case' });

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    for (const role of ['lead', 'viewer', 'outsider']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: `${role}-mcp-${stamp}@exasol.com`, password: 'pw' },
      });
      cookies[role] = r.cookies.find((c) => c.name === 'tcms_session')!.value;
    }
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.projects).where(eq(s.projects.id, otherProjectId));
    for (const role of ['lead', 'viewer', 'outsider']) {
      await db.delete(s.users).where(eq(s.users.email, `${role}-mcp-${stamp}@exasol.com`));
    }
    await pool.end();
  });

  // ---- Task 12.1 -----------------------------------------------------------------------
  it('completes the MCP handshake and enumerates its tools', async () => {
    const init = await rpc('lead', 'initialize');
    expect(init.body.result.serverInfo.name).toBe('exasol-tcms');
    expect(init.body.result.capabilities).toHaveProperty('tools');

    const list = await rpc('lead', 'tools/list');
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('search_cases');
    expect(names).toContain('get_coverage');
    expect(names).toContain('create_case');
    expect(names).toContain('record_result');
  });

  it('declares a valid JSON Schema for every tool', async () => {
    const list = await rpc('lead', 'tools/list');
    for (const tool of list.body.result.tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('refuses MCP without authentication', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(r.statusCode).toBe(401);
  });

  // ---- Task 12.2: reads ----------------------------------------------------------------
  it('reads cases, suites and coverage', async () => {
    const cases = await call('lead', 'search_cases', { projectId, limit: 10 });
    expect(cases.structuredContent.items.length).toBeGreaterThan(0);

    const suites = await call('lead', 'list_suites', { projectId });
    expect(suites.structuredContent.suites.length).toBeGreaterThan(0);

    const coverage = await call('lead', 'get_coverage', { projectId });
    expect(coverage.structuredContent.summary).toHaveProperty('automated');
  });

  it('returns coverage identical to the REST view for the same project', async () => {
    const viaMcp = await call('lead', 'get_coverage', { projectId });
    const viaRest = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/coverage`,
      cookies: { tcms_session: cookies['lead'] as string },
    });
    expect(viaMcp.structuredContent.summary).toEqual(viaRest.json().summary);
  });

  it('accepts a project key as well as an id, for agent ergonomics', async () => {
    const byKey = await call('lead', 'list_suites', { projectId: `mcp${stamp}` });
    expect(byKey.structuredContent.suites.length).toBeGreaterThan(0);
  });

  // ---- Task 12.3: writes ---------------------------------------------------------------
  it('creates a case that is structurally identical to a web-created one', async () => {
    const created = await call('lead', 'create_case', {
      projectId,
      suiteId,
      title: 'Agent authored case',
      priority: 'high',
      steps: [{ action: 'Do the thing', expected: 'It happens' }],
      tags: ['E2E'],
    });
    const caseId = created.structuredContent.id;

    const viaRest = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases/${caseId}`,
      cookies: { tcms_session: cookies['lead'] as string },
    });
    expect(viaRest.statusCode).toBe(200);
    const body = viaRest.json();
    expect(body.title).toBe('Agent authored case');
    expect(body.priority).toBe('high');
    expect(body.steps).toHaveLength(1);
    // Tag normalisation applies identically through MCP.
    expect(body.tags).toEqual(['e2e']);
  });

  // ---- Task 12.6: provenance -----------------------------------------------------------
  it('records MCP as the origin, so agent-authored content is identifiable', async () => {
    const created = await call('lead', 'create_case', {
      projectId,
      suiteId,
      title: 'Provenance check',
      steps: [{ action: 'a', expected: 'b' }],
    });
    const history = await db
      .select()
      .from(s.caseHistory)
      .where(eq(s.caseHistory.caseId, created.structuredContent.id));
    expect(history[0]?.origin).toBe('mcp');
    // The acting human is still named: MCP acts as a user, not anonymously.
    expect(history[0]?.actorId).not.toBeNull();
  });

  // ---- Task 12.4 / 12.5: authorisation is the same, not a mirror -----------------------
  it('refuses a write outside the caller role', async () => {
    const result = await call('viewer', 'create_case', {
      projectId,
      suiteId,
      title: 'Viewer should not create this',
      steps: [{ action: 'a', expected: 'b' }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Not found');
  });

  it('refuses a read for a project the caller has no role in', async () => {
    const result = await call('outsider', 'list_suites', { projectId });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Not found');
  });

  it('applies a permission change to MCP and REST simultaneously', async () => {
    // The viewer cannot create. Promote to lead; MCP must reflect it with no separate step.
    await db
      .update(s.memberships)
      .set({ role: 'lead' })
      .where(
        eq(
          s.memberships.userId,
          (
            await db
              .select()
              .from(s.users)
              .where(eq(s.users.email, `viewer-mcp-${stamp}@exasol.com`))
          )[0]!.id,
        ),
      );

    const allowed = await call('viewer', 'create_case', {
      projectId,
      suiteId,
      title: 'Now permitted',
      steps: [{ action: 'a', expected: 'b' }],
    });
    expect(allowed.isError).toBeUndefined();

    // Demote again; MCP must refuse immediately.
    await db
      .update(s.memberships)
      .set({ role: 'viewer' })
      .where(
        eq(
          s.memberships.userId,
          (
            await db
              .select()
              .from(s.users)
              .where(eq(s.users.email, `viewer-mcp-${stamp}@exasol.com`))
          )[0]!.id,
        ),
      );

    const refused = await call('viewer', 'create_case', {
      projectId,
      suiteId,
      title: 'Refused again',
      steps: [{ action: 'a', expected: 'b' }],
    });
    expect(refused.isError).toBe(true);
  });

  it('reports invalid arguments as a tool error rather than a transport failure', async () => {
    const result = await call('lead', 'create_case', { projectId, suiteId, title: 'No steps' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/steps/i);
  });

  it('reports an unknown tool as a JSON-RPC error', async () => {
    const { body } = await rpc('lead', 'tools/call', { name: 'no_such_tool', arguments: {} });
    expect(body.error.code).toBe(-32602);
  });

  it('reports an unknown method as a JSON-RPC error', async () => {
    const { body } = await rpc('lead', 'resources/list');
    expect(body.error.code).toBe(-32601);
  });
});
