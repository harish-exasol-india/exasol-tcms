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

suite('repository routes (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  const password = 'repo-password';
  const cookies: Record<string, string> = {};
  let projectId: string;
  let rootSuite: string;

  const as = (key: string) => ({ cookies: { tcms_session: cookies[key] as string } });
  const url_ = (path: string) => `/api/projects/${projectId}${path}`;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `repo${stamp}`, name: 'Repo Project' })
      .returning();
    projectId = p!.id;

    for (const role of ['admin', 'lead', 'viewer'] as const) {
      const [u] = await db
        .insert(s.users)
        .values({
          email: `${role}-repo-${stamp}@exasol.com`,
          displayName: role,
          passwordHash: await hashPassword(password),
        })
        .returning();
      await db.insert(s.memberships).values({ userId: u!.id, projectId, role });
    }

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    for (const role of ['admin', 'lead', 'viewer']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: `${role}-repo-${stamp}@exasol.com`, password },
      });
      cookies[role] = r.cookies.find((c) => c.name === 'tcms_session')!.value;
    }

    const created = await app.inject({
      method: 'POST',
      url: url_('/suites'),
      payload: { name: 'Product' },
      ...as('lead'),
    });
    rootSuite = created.json().id;
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.users).where(eq(s.users.email, `admin-repo-${stamp}@exasol.com`));
    await db.delete(s.users).where(eq(s.users.email, `lead-repo-${stamp}@exasol.com`));
    await db.delete(s.users).where(eq(s.users.email, `viewer-repo-${stamp}@exasol.com`));
    await pool.end();
  });

  const makeCase = async (overrides: Record<string, unknown> = {}) => {
    const r = await app.inject({
      method: 'POST',
      url: url_('/cases'),
      payload: {
        suiteId: rootSuite,
        title: 'A case',
        priority: 'high',
        risk: 'medium',
        steps: [{ action: 'Do the thing', expected: 'It happened' }],
        tags: [],
        ...overrides,
      },
      ...as('lead'),
    });
    return r;
  };

  // ---- Task 4.1: suite tree CRUD -----------------------------------------------------
  it('creates, nests, and lists a suite tree with case counts', async () => {
    await makeCase({ title: 'Counted case' });
    const child = await app.inject({
      method: 'POST',
      url: url_('/suites'),
      payload: { parentId: rootSuite, name: 'Component' },
      ...as('lead'),
    });
    expect(child.statusCode).toBe(201);

    const tree = await app.inject({ method: 'GET', url: url_('/suites'), ...as('viewer') });
    const suites = tree.json().suites;
    expect(suites.find((x: { name: string }) => x.name === 'Component').parentId).toBe(rootSuite);
    // Assert a real count, not merely that the field is numeric: a correlated-subquery
    // bug returned 0 for every suite and a type-only check did not catch it.
    const holder = suites.find((x: { name: string }) => x.name === 'Product');
    expect(holder.caseCount).toBeGreaterThan(0);
  });

  it('refuses a cyclic suite move', async () => {
    const childRes = await app.inject({
      method: 'POST',
      url: url_('/suites'),
      payload: { parentId: rootSuite, name: 'Cycle child' },
      ...as('lead'),
    });
    const childId = childRes.json().id;
    const move = await app.inject({
      method: 'PATCH',
      url: url_(`/suites/${rootSuite}`),
      payload: { parentId: childId },
      ...as('lead'),
    });
    expect(move.statusCode).toBe(400);
    expect(move.json().code).toBe('CYCLIC_MOVE');
  });

  it('refuses to delete a suite that still holds cases', async () => {
    const holder = await app.inject({
      method: 'POST',
      url: url_('/suites'),
      payload: { name: 'Holder' },
      ...as('lead'),
    });
    const holderId = holder.json().id;
    await makeCase({ suiteId: holderId, title: 'Occupant' });
    const del = await app.inject({
      method: 'DELETE',
      url: url_(`/suites/${holderId}`),
      ...as('lead'),
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().code).toBe('SUITE_NOT_EMPTY');
  });

  // ---- Task 4.2: case CRUD -----------------------------------------------------------
  it('creates a case with full metadata and a generated reference', async () => {
    const r = await makeCase({ title: 'Full metadata case', tags: ['E2E'] });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.ref).toMatch(/^REPO\d+-\d+$/);
    expect(body.priority).toBe('high');
    expect(body.steps).toHaveLength(1);
    expect(body.suitePath).toContain('Product');
  });

  it('rejects a case with no steps', async () => {
    const r = await makeCase({ steps: [] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('Validation failed');
  });

  it('rejects a step that is both literal and a shared-step reference', async () => {
    const r = await makeCase({
      steps: [{ action: 'x', sharedStepId: '00000000-0000-0000-0000-000000000000' }],
    });
    expect(r.statusCode).toBe(400);
  });

  it('allocates references without reuse after deletion', async () => {
    const first = (await makeCase({ title: 'First' })).json();
    await app.inject({
      method: 'DELETE',
      url: url_(`/cases/${first.id}`),
      ...as('lead'),
    });
    const second = (await makeCase({ title: 'Second' })).json();
    expect(second.ref).not.toBe(first.ref);
  });

  it('refuses case creation by a viewer', async () => {
    const r = await app.inject({
      method: 'POST',
      url: url_('/cases'),
      payload: {
        suiteId: rootSuite,
        title: 'Nope',
        steps: [{ action: 'a', expected: 'b' }],
        tags: [],
      },
      ...as('viewer'),
    });
    expect(r.statusCode).toBe(404);
  });

  // ---- Task 4.3 / 4.4: tag normalisation and suggestions ------------------------------
  it('normalises tags on write so variants converge on one tag', async () => {
    const a = (await makeCase({ title: 'Tag A', tags: ['  End-To-End  '] })).json();
    const b = (await makeCase({ title: 'Tag B', tags: ['END TO END'] })).json();
    expect(a.tags).toEqual(['end-to-end']);
    expect(b.tags).toEqual(['end-to-end']);

    const rows = await db.select().from(s.tags).where(eq(s.tags.projectId, projectId));
    expect(rows.filter((t) => t.name === 'end-to-end')).toHaveLength(1);
  });

  it('offers existing tags as suggestions, most used first', async () => {
    const r = await app.inject({ method: 'GET', url: url_('/tags?prefix=end'), ...as('viewer') });
    expect(r.statusCode).toBe(200);
    const tags = r.json().tags;
    expect(tags[0].name).toBe('end-to-end');
    expect(tags[0].usageCount).toBeGreaterThanOrEqual(2);
  });

  // ---- Task 4.5 / 4.6: shared steps ---------------------------------------------------
  it('propagates a shared step edit to every referencing case', async () => {
    const block = (
      await app.inject({
        method: 'POST',
        url: url_('/shared-steps'),
        payload: { name: 'Log in as admin', items: [{ action: 'Open /login', expected: 'Form' }] },
        ...as('lead'),
      })
    ).json();

    const c = (
      await makeCase({
        title: 'Uses shared step',
        steps: [{ sharedStepId: block.id }, { action: 'Then', expected: 'Result' }],
      })
    ).json();

    expect(c.steps[0].sharedStepItems[0].action).toBe('Open /login');

    await app.inject({
      method: 'PATCH',
      url: url_(`/shared-steps/${block.id}`),
      payload: { items: [{ action: 'Open /signin', expected: 'Form v2' }] },
      ...as('lead'),
    });

    const reloaded = (
      await app.inject({ method: 'GET', url: url_(`/cases/${c.id}`), ...as('viewer') })
    ).json();
    expect(reloaded.steps[0].sharedStepItems[0].action).toBe('Open /signin');
  });

  it('reports how many cases and open runs a shared step edit would affect', async () => {
    const list = (
      await app.inject({ method: 'GET', url: url_('/shared-steps'), ...as('viewer') })
    ).json();
    const block = list.sharedSteps.find((b: { name: string }) => b.name === 'Log in as admin');
    expect(block.referencingCaseCount).toBeGreaterThanOrEqual(1);
    expect(typeof block.affectedOpenRunCount).toBe('number');
  });

  it('refuses to delete a shared step still referenced by a case', async () => {
    const list = (
      await app.inject({ method: 'GET', url: url_('/shared-steps'), ...as('viewer') })
    ).json();
    const block = list.sharedSteps.find((b: { name: string }) => b.name === 'Log in as admin');
    const del = await app.inject({
      method: 'DELETE',
      url: url_(`/shared-steps/${block.id}`),
      ...as('lead'),
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().code).toBe('SHARED_STEP_IN_USE');
  });

  // ---- Task 4.7: custom fields --------------------------------------------------------
  it('stores custom field values and reports usage before removal', async () => {
    const field = (
      await app.inject({
        method: 'POST',
        url: url_('/custom-fields'),
        payload: { key: 'component_owner', label: 'Component Owner', type: 'text' },
        ...as('admin'),
      })
    ).json();

    await makeCase({
      title: 'With custom field',
      customFields: { component_owner: 'team-storage' },
    });

    const usage = (
      await app.inject({
        method: 'GET',
        url: url_(`/custom-fields/${field.id}/usage`),
        ...as('viewer'),
      })
    ).json();
    expect(usage.usageCount).toBeGreaterThanOrEqual(1);
  });

  it('restricts custom field definition to administrators', async () => {
    // The test-repository spec says administrators define custom fields; a lead may author
    // cases but not change the shape of a case.
    const r = await app.inject({
      method: 'POST',
      url: url_('/custom-fields'),
      payload: { key: 'lead_attempt', label: 'Nope', type: 'text' },
      ...as('lead'),
    });
    expect(r.statusCode).toBe(404);
  });

  it('rejects a duplicate custom field key', async () => {
    const r = await app.inject({
      method: 'POST',
      url: url_('/custom-fields'),
      payload: { key: 'component_owner', label: 'Dup', type: 'text' },
      ...as('admin'),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('DUPLICATE_KEY');
  });

  // ---- Task 4.8 / 4.9: history --------------------------------------------------------
  it('records a history entry for every mutation with actor and origin', async () => {
    const c = (await makeCase({ title: 'Historic' })).json();
    await app.inject({
      method: 'PATCH',
      url: url_(`/cases/${c.id}`),
      payload: { title: 'Historic v2' },
      ...as('lead'),
    });
    await app.inject({
      method: 'PATCH',
      url: url_(`/cases/${c.id}`),
      payload: { priority: 'critical' },
      ...as('lead'),
    });

    const history = (
      await app.inject({ method: 'GET', url: url_(`/cases/${c.id}/history`), ...as('viewer') })
    ).json();
    expect(history.entries).toHaveLength(3); // created + 2 updates
    expect(history.entries[0].origin).toBe('ui');
    expect(history.entries[0].actorName).toBe('lead');
    expect(history.entries.at(-1).action).toBe('created');
    const titleChange = history.entries.find((e: { changedFields: string[] }) =>
      e.changedFields.includes('title'),
    );
    expect(titleChange).toBeDefined();
  });

  it('keeps history across a rename and a suite move', async () => {
    const target = (
      await app.inject({
        method: 'POST',
        url: url_('/suites'),
        payload: { name: 'Moved-To' },
        ...as('lead'),
      })
    ).json();
    const c = (await makeCase({ title: 'Movable' })).json();

    await app.inject({
      method: 'PATCH',
      url: url_(`/cases/${c.id}`),
      payload: { title: 'Renamed', suiteId: target.id },
      ...as('lead'),
    });

    const after = (
      await app.inject({ method: 'GET', url: url_(`/cases/${c.id}`), ...as('viewer') })
    ).json();
    expect(after.title).toBe('Renamed');
    expect(after.suitePath).toContain('Moved-To');

    const history = (
      await app.inject({ method: 'GET', url: url_(`/cases/${c.id}/history`), ...as('viewer') })
    ).json();
    // The creation entry survives the rename and the move.
    expect(history.entries.at(-1).action).toBe('created');
    expect(history.entries).toHaveLength(2);
  });

  it('does not record a history entry when nothing actually changed', async () => {
    const c = (await makeCase({ title: 'Unchanged' })).json();
    await app.inject({
      method: 'PATCH',
      url: url_(`/cases/${c.id}`),
      payload: { title: 'Unchanged' },
      ...as('lead'),
    });
    const history = (
      await app.inject({ method: 'GET', url: url_(`/cases/${c.id}/history`), ...as('viewer') })
    ).json();
    expect(history.entries).toHaveLength(1);
  });

  // ---- listing ------------------------------------------------------------------------
  it('lists cases filtered by suite subtree, tag, and search', async () => {
    const all = (
      await app.inject({ method: 'GET', url: url_('/cases?limit=1000'), ...as('viewer') })
    ).json();
    expect(all.total).toBeGreaterThan(0);
    expect(all.items.length).toBe(all.total);

    const byTag = (
      await app.inject({ method: 'GET', url: url_('/cases?tag=end-to-end'), ...as('viewer') })
    ).json();
    expect(byTag.total).toBe(2);

    const bySearch = (
      await app.inject({ method: 'GET', url: url_('/cases?search=Historic'), ...as('viewer') })
    ).json();
    expect(bySearch.items.every((i: { title: string }) => i.title.includes('Historic'))).toBe(true);
  });

  it('pages with a stable cursor and a total that does not shrink', async () => {
    const first = (
      await app.inject({ method: 'GET', url: url_('/cases?limit=2'), ...as('viewer') })
    ).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await app.inject({
        method: 'GET',
        url: url_(`/cases?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`),
        ...as('viewer'),
      })
    ).json();
    // The total describes the whole filtered set, not the remaining page.
    expect(second.total).toBe(first.total);
    const overlap = second.items.filter((i: { id: string }) =>
      first.items.some((f: { id: string }) => f.id === i.id),
    );
    expect(overlap).toHaveLength(0);
  });

  it('excludes soft-deleted cases from listings but keeps their history', async () => {
    const c = (await makeCase({ title: 'To be deleted' })).json();
    await app.inject({ method: 'DELETE', url: url_(`/cases/${c.id}`), ...as('lead') });

    const list = (
      await app.inject({ method: 'GET', url: url_('/cases?search=To be deleted'), ...as('viewer') })
    ).json();
    expect(list.items).toHaveLength(0);

    const rows = await db.select().from(s.caseHistory).where(eq(s.caseHistory.caseId, c.id));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.action === 'deleted')).toBe(true);
  });
});
