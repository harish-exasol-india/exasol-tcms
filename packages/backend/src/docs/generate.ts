/**
 * Generates the API reference from the running application.
 *
 * Written from the live route table and the MCP tool registry rather than maintained by
 * hand: a transcribed reference drifts, and documentation listing an endpoint that no
 * longer exists is worse than none. Run with `npm run docs:api`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { zodToJsonSchema } from '../mcp/json-schema.js';
import { TOOLS } from '../mcp/tools.js';

type Route = { method: string; url: string };

/**
 * Fastify prints routes as an indented tree where a child line carries only its path
 * segment. Full paths are reconstructed by tracking the prefix at each depth.
 */
function parseRouteTree(tree: string): Route[] {
  const routes: Route[] = [];
  const prefixAtDepth: string[] = [];

  for (const line of tree.split('\n')) {
    const match = /^([\s│]*)[├└]──\s+(\S+)\s*(?:\(([^)]+)\))?/.exec(line);
    if (!match) continue;
    const [, indent = '', segment = '', methods] = match;
    const depth = Math.floor(indent.length / 4);
    const prefix = depth === 0 ? '' : (prefixAtDepth[depth - 1] ?? '');
    const url = `${prefix}${segment}`;
    prefixAtDepth[depth] = url;
    prefixAtDepth.length = depth + 1;

    if (!methods) continue;
    for (const method of methods.split(', ')) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routes.push({ method, url });
    }
  }
  return routes;
}

/** The permission each route family requires. Ordered: the first match wins. */
const PERMISSIONS: [RegExp, string][] = [
  [/^\/healthz$|^\/readyz$/, 'none'],
  [/^\/api\/auth/, 'none (authentication itself)'],
  [/^\/api\/retention$/, 'none (policy disclosure)'],
  [/^\/api\/admin/, '`project.settings` on some project'],
  [/assignable-users/, '`member.manage`'],
  [/\/members/, '`case.read` to list, `member.manage` to change'],
  [/\/shared-steps/, '`case.read` to read, `shared_step.manage` to change'],
  [/\/custom-fields/, '`case.read` to read, `custom_field.manage` to change'],
  [/\/suites/, '`case.read` to read, `suite.manage` to change'],
  [/\/cases\/.*\/history/, '`case.read`'],
  [/\/results\/junit/, '`run.create` (token scope `results:write`)'],
  [/\/automation\/bindings/, '`report.read`'],
  [/\/coverage/, '`report.read`'],
  [/\/plans/, '`run.read` to read, `plan.manage` to change'],
  [/\/environments/, '`run.read` to read, `environment.manage` to change'],
  [/\/readiness/, '`report.read`'],
  [/\/sign-offs\/.*\/complete/, '`release.sign_off`'],
  [/\/sign-offs/, '`release.manage`'],
  [/\/releases/, '`run.read` to read, `release.manage` to change'],
  [/\/triage/, '`run.read` to read, `triage.update` to change'],
  [/\/attachments/, '`run.execute` to upload, `run.read` to fetch'],
  [/\/defects/, '`defect.link`'],
  [/\/runs.*\/close/, '`run.close`'],
  [/\/runs\/.*\/cases/, '`run.read` to read, `run.execute` to record'],
  [/\/runs/, '`run.read` to read, `run.create` to create'],
  [/\/metrics/, '`report.read`'],
  [/\/export/, '`export.perform`'],
  [/\/results$/, '`report.read`'],
  [/\/tags/, '`case.read`'],
  [/\/cases/, '`case.read` / `case.create` / `case.edit` / `case.delete`'],
  [/^\/mcp/, 'per tool; see the MCP section'],
];

const permissionFor = (url: string) =>
  PERMISSIONS.find(([pattern]) => pattern.test(url))?.[1] ?? 'project membership';

const GROUPS: [RegExp, string][] = [
  [/^\/healthz$|^\/readyz$/, 'Operations'],
  [/^\/api\/auth/, 'Authentication'],
  [/^\/mcp/, 'MCP'],
  [/\/members|assignable-users/, 'Access control'],
  [/\/results\/junit|\/automation\//, 'Result ingestion'],
  [/\/coverage/, 'Coverage'],
  [/\/triage/, 'Triage'],
  [/\/metrics|\/readiness|\/sign-offs/, 'Reporting'],
  [/\/runs|\/attachments|\/defects/, 'Execution'],
  [/\/plans|\/environments|\/releases/, 'Planning'],
  [/\/export|\/retention|\/admin|projects\/:projectId\/results$/, 'Data lifecycle'],
];

const groupOf = (url: string) =>
  GROUPS.find(([pattern]) => pattern.test(url))?.[1] ?? 'Test repository';

const ORDER = [
  'Operations',
  'Authentication',
  'Access control',
  'Test repository',
  'Planning',
  'Execution',
  'Result ingestion',
  'Triage',
  'Coverage',
  'Reporting',
  'Data lifecycle',
  'MCP',
];

const app = await buildApp(
  loadConfig({ DATABASE_URL: 'postgres://docs/docs', LOG_LEVEL: 'fatal' }),
);
await app.ready();

const routes = parseRouteTree(app.printRoutes({ commonPrefix: false }));
const grouped = new Map<string, Route[]>();
for (const route of routes) {
  const group = groupOf(route.url);
  grouped.set(group, [...(grouped.get(group) ?? []), route]);
}

const out: string[] = [];
const w = (line = '') => out.push(line);

w('# API reference');
w();
w('_Generated from the running application by `npm run docs:api`. Do not edit by hand._');
w();
w('## Authentication');
w();
w('Two credential kinds, both resolving to the same principal and the same per-project');
w('permission check — there is no separate path for machines, agents, or the web interface.');
w();
w('| Kind | Credential | Used by |');
w('|---|---|---|');
w('| Session | `tcms_session` cookie (httpOnly, SameSite=Lax) | People, via the web interface |');
w('| API token | `Authorization: Bearer tcms_…` | CI and machines |');
w();
w('An API token is scoped to exactly one project and to a set of scopes (`results:write`,');
w('`results:read`, `cases:read`, `cases:write`). It is displayed once at creation and stored');
w('only as a SHA-256 hash; it can be revoked without affecting anything else.');
w();
w('**Denials are undifferentiated.** A caller holding no role in a project receives `404`,');
w('never `403`: the existence of a project is not disclosed to someone who cannot see it.');
w();
w('## Errors');
w();
w('| Status | Meaning |');
w('|---|---|');
w('| `400` | Validation failed, or a documented `code` such as `INVALID_REPORT` |');
w('| `401` | No credentials, or an expired or revoked session |');
w('| `404` | Not found, or not visible to this caller |');
w('| `409` | Conflict. `RESULT_CONFLICT` carries `current`, the result that won |');
w('| `413` | Upload exceeds the attachment size limit |');
w();
w('Error bodies may carry fields beyond `error` and `code`, so clients must not assume the');
w('shape is closed. A `RESULT_CONFLICT` carries the competing result, which the caller needs');
w('in order to reconcile rather than blindly retry.');
w();
w('## Endpoints');
w();

for (const group of ORDER) {
  const groupRoutes = grouped.get(group);
  if (!groupRoutes?.length) continue;
  w(`### ${group}`);
  w();
  w('| Method | Path | Required permission |');
  w('|---|---|---|');
  const seen = new Set<string>();
  for (const route of [...groupRoutes].sort((a, b) => a.url.localeCompare(b.url))) {
    const key = `${route.method} ${route.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    w(`| \`${route.method}\` | \`${route.url}\` | ${permissionFor(route.url)} |`);
  }
  w();
}

w('## MCP');
w();
w('The MCP server is mounted **in-process** at `POST /mcp` and speaks JSON-RPC 2.0 over');
w('HTTP. It authenticates exactly as the REST API does, and every tool resolves the');
w("caller's per-project role through the same authorisation function. There is deliberately");
w('no second permission path, so a change to the role matrix takes effect for MCP and the');
w('web interface simultaneously.');
w();
w('Writes are recorded with `mcp` provenance, so agent-authored content stays distinguishable');
w('from human-authored content.');
w();
w('| Tool | Permission | Description |');
w('|---|---|---|');
for (const tool of TOOLS) {
  w(`| \`${tool.name}\` | \`${tool.permission}\` | ${tool.description.replace(/\s+/g, ' ')} |`);
}
w();
w('### Tool parameters');
w();
for (const tool of TOOLS) {
  const schema = zodToJsonSchema(tool.inputSchema) as {
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  w(`#### \`${tool.name}\``);
  w();
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) {
    w('Takes no parameters.');
  } else {
    w('| Parameter | Type | Required | Notes |');
    w('|---|---|---|---|');
    for (const [name, spec] of properties) {
      const required = schema.required?.includes(name) ? 'yes' : 'no';
      const type = spec.enum
        ? spec.enum.map((v) => `\`${v}\``).join(' \\| ')
        : (spec.type ?? 'any');
      w(`| \`${name}\` | ${type} | ${required} | ${spec.description ?? ''} |`);
    }
  }
  w();
}

// Written relative to the repository root, so the output lands in the same place whether
// the generator is run from the package or the workspace root.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const target = path.join(repoRoot, 'docs', 'api.md');
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, `${out.join('\n')}\n`);
console.log(`${target} written: ${routes.length} routes, ${TOOLS.length} MCP tools`);
await app.close();
process.exit(0);
