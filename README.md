# Exasol TCMS

An internal test case management system for Exasol: one repository for manual and
automated tests, headless result ingestion from CI, automation-coverage reporting,
failure triage that carries forward across runs, a release-readiness view with a
sign-off gate, and an MCP server so agents can read and write the same data through the
same permission checks as the web UI.

Modelled on Qase's concept set (cases, suites, shared steps, custom fields, plans,
environments, releases, runs, defect links) but scoped to what Exasol's acceptance
criteria actually ask for, and honest about what it does not do — see
[Known gaps](#known-gaps).

**Status:** the `add-tcms-foundation` change is complete — 112/112 tasks, all CI gates
green, 228 unit/integration tests and 10 system suites passing against the running
stack. Independently verified against the acceptance criteria: **28 met, 3 partially
met, 2 not met of 33**, with every shortfall matching a gap the proposal declared in
advance ([docs/acceptance-report.md](docs/acceptance-report.md)).

---

## Contents

- [Architecture](#architecture)
- [Technology choices](#technology-choices)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [Authentication and access control](#authentication-and-access-control)
- [What the system does](#what-the-system-does)
- [MCP integration](#mcp-integration)
- [Testing and verification](#testing-and-verification)
- [CI gates](#ci-gates)
- [Performance notes](#performance-notes)
- [Known gaps](#known-gaps)
- [Documentation](#documentation)

---

## Architecture

Four containers on one host. Frontend and backend are separate images, as required.

```
  browser ──▶ frontend (nginx :8080)  ──proxy──▶ backend (Fastify :3000)
                 SPA static assets                 │   REST  /api/*
                                                   │   MCP   /mcp  (in-process)
                                                   ├──▶ postgres :5432   cases, runs, results
                                                   └──▶ minio    :9000   attachments

  GitHub Actions ──curl POST JUnit XML──▶ backend /api/projects/:id/results/junit
```

Only `postgres` and `minio` hold state; the application containers are stateless and
disposable. That claim is audited in CI by `scripts/check-twelve-factor.mjs`, because a
twelve-factor claim nobody checks is just a comment.

nginx serves the SPA and proxies `/api` and `/mcp`, so the browser sees a single origin
and the SPA needs no CORS in normal deployment. It is configured with
`client_max_body_size 33m` and `proxy_request_buffering off` — the default 1 MB cap
silently made the application's own 25 MB attachment and 32 MB ingest limits
unreachable behind an opaque HTML 413.

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript 7.0** (`tsgo`, native compiler) | Mandated. Note it exposes **no JS compiler API** — only `version`/`versionMajorMinor` — which rules out any tool that type-checks through the API. |
| Lint/format | **Biome** | typescript-eslint is *impossible* under TS 7 for the reason above. Biome needs no compiler API. |
| Backend | **Fastify 5 + Zod** | Decorator-free, so nothing depends on TS 7's decorator behaviour. Zod schemas are the single source of truth for validation, types and the generated API docs. |
| ORM | **Drizzle ORM 0.45** | Proven to compile under TS 7 with a 22-assertion type harness plus a negative control before it was committed to. |
| Database | **Postgres 17** | Exasol is entirely out of scope. `case_result` is range-partitioned by month. |
| Objects | **MinIO** (S3 API) | Attachments; the same API in every environment, so nothing is dev-only. |
| Frontend | **React 19 + Vite + TanStack** Router/Query/Table/Virtual | Virtualised case lists keep 25k cases interactive. |
| Deployment | **Docker Compose** | One host, Kubernetes-ready — no local filesystem state, config from the environment only. |

Rationale and rejected alternatives for all 23 decisions:
[`openspec/changes/add-tcms-foundation/design.md`](openspec/changes/add-tcms-foundation/design.md).

## Repository layout

```
packages/
  shared/      Zod contracts shared by both ends: permissions matrix, roles,
               tag normalisation, request/response schemas.
  backend/     Fastify app.
    src/db/          Drizzle schema (identity, repository, authoring, planning,
                     execution, evidence, automation, session), migration runner, seed.
    src/auth/        Argon2id passwords, JWT sessions, API tokens, authorize().
    src/services/    Domain logic: cases, suites, runs, coverage, triage, metrics,
                     release readiness, export, retention, storage.
    src/ingestion/    JUnit XML parsing, failure signatures, case binding.
    src/http/routes/  REST surface (68 routes).
    src/mcp/          MCP server and its 17 tools.
    src/docs/         Generates docs/api.md from the live route table.
    drizzle/          6 forward migrations + 6 paired down scripts.
  frontend/    React SPA + nginx image.
docs/          API reference, operations runbook, CI guide, acceptance report.
e2e/           14 browser and system scripts driven by Playwright and fetch.
scripts/       backup/restore and the three CI drift checks.
openspec/      Spec-driven change artifacts: proposal, design, 11 capability specs, tasks.
```

## Quick start

Requires Docker and Node 22+.

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend node dist/db/migrate-cli.js up
docker compose exec backend node dist/db/seed-cli.js     # optional demo dataset
```

`docker compose ps` should show all four services healthy. The UI is at
<http://localhost:8080>, the API at <http://localhost:3000>.

Local development without containers:

```bash
npm ci
npm run build --workspace @tcms/shared   # backend and frontend consume its declarations
npm run dev --workspace @tcms/backend
npm run dev --workspace @tcms/frontend
```

**Seeding scale.** `SEED_SCALE=12 node dist/db/seed-cli.js` multiplies the default
2,000 cases / 30 runs / 400 results-per-run — the dataset the performance figures below
were measured against was ~25k cases and ~210k results.

**Creating the first account.** There is deliberately no self-registration route and no
account privileged by identity, so the first user is inserted directly — the same path
[`e2e/fixture.mjs`](e2e/fixture.mjs) uses:

```js
import { hashPassword } from './packages/backend/dist/auth/password.js';
import { createDatabase, createPool } from './packages/backend/dist/db/client.js';
import * as s from './packages/backend/dist/db/schema/index.js';

const db = createDatabase(createPool(process.env.DATABASE_URL));
const [user] = await db.insert(s.users).values({
  email: 'you@exasol.com', displayName: 'You',
  passwordHash: await hashPassword('…'),
}).returning();
await db.insert(s.memberships).values({ userId: user.id, projectId, role: 'admin' });
```

Everything after that — inviting members, changing roles — is done in the UI by a
project admin.

> The credentials used throughout `e2e/` (`harish.ekambaram@exasol.com` /
> `demo-password-123`) are **development-only** and hardcoded in those scripts. They
> must not exist in a production deployment.

## Configuration

All configuration arrives through the environment and is parsed by Zod at startup, so a
bad value fails immediately instead of surfacing as a runtime error later. Nothing is
read from the container filesystem.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Required. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `LOG_LEVEL` | `info` | |
| `CORS_ORIGIN` | `http://localhost:8080` | Must name the real origin in production. |
| `COOKIE_SECRET` | dev placeholder | **Change before production.** |
| `ATTACHMENT_MAX_BYTES` | `26214400` (25 MB) | Must stay under nginx's `client_max_body_size`. |
| `RETENTION_MONTHS` | `12` | Execution-history window. |
| `BINDING_STALE_DAYS` | `30` | When an automation binding is reported stale. |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` | MinIO defaults | |
| `JIRA_BASE_URL` / `JIRA_KEY_PATTERN` | Exasol Jira, `^[A-Z][A-Z0-9]+-\d+$` | Link-only; no Jira credentials needed. |

Settings that **must** change before production are listed in
[docs/operations.md](docs/operations.md#settings-that-must-be-changed-before-production).

## Database and migrations

Six migrations, each with a paired down script in `packages/backend/drizzle/down/`.
`drizzle-kit` generates forward-only migrations, so the down scripts are written by hand
and their existence is enforced in CI — without the pair, the documented rollback would
be fiction.

```bash
node dist/db/migrate-cli.js up      # apply all pending
node dist/db/migrate-cli.js down    # reverse the most recent, one per invocation
npm run migrations:check            # every migration has a paired down script
```

`case_result` is range-partitioned by month, which is what makes the 12-month retention
window a partition drop rather than a mass delete. Backup and restore are
`scripts/backup.sh` / `scripts/restore.sh`, verified by actually dropping the database
and restoring it: 25,000 cases, 210,554 results, 8 attachments and all 6 partitions came
back matching.

## Authentication and access control

- **Local accounts** with Argon2id password hashing and JWT sessions in signed cookies,
  behind an `AuthProvider` interface so OIDC is an adapter, not a schema migration. The
  `provider`/`external_id` columns exist from day one.
- **Scoped API tokens** for CI: project-scoped, permission-limited, revocable, shown
  once, and stored only as a SHA-256 hash.
- **Per-project RBAC** with four roles. The matrix is *data*, not branching logic, and
  every guarded operation names a permission rather than checking a role:

  | Role | Grants |
  |---|---|
  | `viewer` | read cases/runs/reports, export |
  | `tester` | viewer + execute runs, link defects, update triage |
  | `lead` | tester + author cases/suites/shared steps, manage plans, environments, releases, sign off, create/close runs |
  | `admin` | everything, including project settings, membership and tokens |

  No account is privileged by identity — the structural fix for the "hardcoded admin"
  complaint in the acceptance criteria. Every decision funnels through a single
  `authorize()` call, and a denial on a resource the caller cannot see returns **404,
  not 403**, so the API does not leak the existence of other projects' data.

## What the system does

**Test repository.** Cases organised in a suite tree (product / component / module) plus
free-form normalised tags for the remaining axes: release stream, test level, workflow.
Ownership, priority, risk, preconditions, steps, expected results and automation status
on every case; shared steps and custom fields; full per-case change history recording
the actor, timestamp and the interface the change came from (`ui` / `api` / `mcp`).
Optimistic concurrency with version tokens throughout.

**Planning.** Reusable test plans, environments and configurations, and
releases/milestones that runs and reporting attach to.

**Manual execution.** Structured runs for UAT and release validation, step-level
results, keyboard-driven execution (`1`–`4` for the outcomes), evidence attachments in
MinIO, and defect links to Jira validated against the key format and rendered as
outbound deep links. Two testers on the same run get an explicit conflict prompt showing
what the other person recorded, rather than a silent last-write-wins.

**Result ingestion.** One `curl` of JUnit XML — no client library, nothing to keep in
step with a TCMS release:

```bash
curl --fail-with-body -X POST \
  "$TCMS_URL/api/projects/$PROJECT_ID/results/junit?release=$RELEASE&environment=ci&branch=$BRANCH&commitSha=$SHA" \
  -H "Authorization: Bearer $TCMS_TOKEN" -H 'Content-Type: application/xml' \
  --data-binary @results.xml
```

The run is created automatically; there is no approval or reconciliation step. Pytest
and Playwright are both covered by the one JUnit parser, tested against real output from
each. Automated tests bind to managed cases by declared case ID, falling back to name
match with a promotion path, and stale bindings are reported. Full workflow in
[docs/ci/github-actions.md](docs/ci/github-actions.md).

**Failure triage.** Each failure gets a signature; triage state carries forward
automatically to the next matching failure, so a known issue does not have to be
re-triaged every night. "New" means genuinely first-seen — no earlier result shares the
signature — rather than merely carrying an inherited label.

**Coverage.** Automation coverage in three mutually exclusive buckets that sum to the
total — automated, manual-only, never executed — filterable by suite subtree, tag,
custom field and release, and grouped by category tag.

**Release readiness.** Execution progress, blocking failures, known issues, coverage
gaps, UAT status and the sign-off gate in one view. The gate records approvals; it does
not compute a verdict from evidence (an explicit, declared design decision).

**Metrics.** Pass rate, failure rate, runtime percentiles, coverage, flakiness
candidates and defect age bands, with sparkline trend views bounded by — and labelled
with — the 12-month retention window.

**Data lifecycle.** A 12-month execution-history window covering runs, results, step
results, defect links and attachments; managed test assets (cases, suites, shared steps,
plans and their history) are never aged out. Retention runs dry-first. Results export as
a streaming CSV and through a paginated REST endpoint.

The full REST surface — 68 routes, each with its required permission — is in
[docs/api.md](docs/api.md), **generated from the live Fastify route table** and checked
for drift in CI.

## MCP integration

The MCP server is mounted in-process at `POST /mcp` and speaks JSON-RPC 2.0. It exposes
**17 tools** — 11 read, 6 write:

```
read    list_projects  list_suites  search_cases  get_case  get_coverage  list_runs
        get_run  get_failure_triage  get_release_readiness  get_metrics
        get_automation_bindings
write   create_case  update_case  create_run  record_result  update_triage  link_defect
```

Every tool resolves the caller's per-project role through the *same* `authorize()`
function as the web UI. There is no second permission path to keep in sync — which is
the point. Writes are recorded with origin `mcp`, so the change history distinguishes
what an agent did from what a person did.

## Testing and verification

```bash
npm test                     # 228 tests across 25 files (vitest)
bash e2e/run-all.sh          # 10 system suites against a running, seeded stack
```

The system suites drive a real browser (Playwright) or a real HTTP client against the
deployed containers: `auth-flow`, `member-admin`, `repository`, `automation`,
`coverage`, `execution`, `concurrency`, `resilience`, `rehearsal`, `acceptance`. Plus
`dashboard-perf`, `export-stream` and `ingest-load` for measurement.

Two are worth calling out. **`rehearsal`** walks the whole product in 22 steps —
authoring a case, uploading CI results, triage carry-forward, UAT execution, defect
linking, sign-off. **`acceptance`** reads verdicts from live behaviour and regenerates
[docs/acceptance-report.md](docs/acceptance-report.md); it also cross-checks the
declared-gaps table in the proposal against what it observed, and fails if a gap was
declared but is not real, or is real but was not declared.

Verified by doing rather than asserting: a full backup/restore after dropping the
database; a migration rollback and roll-forward with data intact; that exports stream
(210,554 rows in 2.5s under 3 MiB memory growth, and that growth does not scale with
payload size); and that the backend survives a Postgres restart (`RestartCount=0`).

## CI gates

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every PR and push to
`main`:

| Gate | Command |
|---|---|
| Lint and format | `npx biome ci .` |
| Typecheck | `npm run typecheck` |
| Tests | `npm test` |
| Build | `npm run build` |
| API docs are current | `npm run docs:check` |
| Migrations are reversible | `npm run migrations:check` |
| Twelve-factor audit | `node scripts/check-twelve-factor.mjs` |

The last three exist so that three things that would otherwise rot silently cannot:
documentation drifting from the route table, a migration shipping without its rollback,
and configuration creeping out of the environment and into a file.

## Performance notes

Measured, not assumed — which is how each of these was found.

| Path | Before | After |
|---|---|---|
| Coverage over 25k cases | 216,906 ms (504 at nginx; 4.8 billion row examinations) | **70 ms** — a missing index on `run_case.case_id` |
| Automation binding report | 936 ms, loading 100,903 rows to render 300 | **46 ms** — aggregate in SQL, filter server-side |
| Case list, 25k cases | 3,012 DOM rows (virtualisation silently inert) | **27 rows** — a missing `min-height: 0` in the flex chain |

Materialised views were considered and *not* added: measurement showed the partitioned
tables with correct indexes were fast enough, and a matview would have bought staleness
for nothing.

## Known gaps

Declared in the proposal before implementation, and confirmed still real by the
acceptance run:

| Area | Gap | Why |
|---|---|---|
| AC 4 | Defect severity/age breakdowns | Jira is link-only; state is not read back |
| AC 4 | Sign-off gate is approval-based | Records approvals; does not compute a verdict |
| AC 5 | No evidence from automated runs | JUnit XML carries no attachment mechanism |
| AC 7 | No in-run retry/flake data | Cross-run flakiness works; within-run retries are not captured |
| AC 7 | No trends beyond 12 months | Flat retention window |
| AC 9 | No enterprise SSO | Local accounts now; OIDC pluggable behind `AuthProvider` |

One further caveat: the GitHub Actions integration has been exercised by `curl` against
a local instance, **not** by an actual Actions run.

Also worth knowing before extending the system: runs execute the *latest* case version
rather than pinning one, so editing a shared step changes the content of every in-flight
run that references it. This is deliberate and documented (design Decision 9), but it is
the sharpest edge in the model.

## Documentation

| Document | Contents |
|---|---|
| [docs/api.md](docs/api.md) | 68 REST routes with required permissions, and the 17 MCP tools. Generated. |
| [docs/operations.md](docs/operations.md) | Runbook: deploy, upgrade, roll back, backup/restore, health, retention, tokens, known limits |
| [docs/ci/github-actions.md](docs/ci/github-actions.md) | Workflow for reporting results from CI |
| [docs/acceptance-report.md](docs/acceptance-report.md) | Per-criterion verdicts read from live behaviour. Generated. |
| [openspec/changes/add-tcms-foundation/](openspec/changes/add-tcms-foundation/) | Proposal, design (23 decisions), 11 capability specs, 112 tasks |
