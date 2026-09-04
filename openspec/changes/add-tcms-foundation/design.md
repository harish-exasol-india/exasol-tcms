## Context

Greenfield. The repository contains no application code. See `proposal.md` — Why for
motivation and the acceptance criteria being answered.

Fixed constraints going in: TypeScript 7 as the primary language, frontend and backend in
separate containers. One constraint was reversed during design — an initial direction to
use Exasol as the primary database — and that reversal is recorded as Decision 1 because
it is the decision the rest of this document rests on.

Scale envelope this design targets: roughly 100 users, 25,000 managed test cases, and
100,000 automated results per day. At a twelve-month retention window that is on the order
of 36 million result rows in steady state.

```
                 +----------------------------------+
                 |  frontend  [container]           |
                 |  React 19 + Vite + TypeScript 7  |
                 |  TanStack Router / Query / Table |
                 +----------------+-----------------+
                                  | HTTPS
                 +----------------v-----------------+        +---------------+
   GitHub        |  backend  [container]            |        | postgres      |
   Actions ----->|  Fastify + Zod + Drizzle         |<------>| [container]   |
   JUnit XML     |    /api/*   REST + CSV export    |  pg    | results       |
   + release,    |    /mcp     MCP (read+write)     |        | partitioned   |
     env, sha,   |    /healthz /readyz              |        | by month      |
     branch      +----+--------------------------+--+        +---------------+
   bearer token       |                          |
                      v                          v
             +----------------+         +------------------+
             | minio          |         | Jira             |
             | [container]    |         | outbound deep    |
             | attachments    |         | links only       |
             +----------------+         +------------------+
```

Domain model:

```
  Project
    +-- Suite (nested tree: product / component / module)
    |     +-- TestCase
    |           +-- Step[]  (may reference SharedStep)
    |           +-- Tag[], CustomFieldValue[]
    |           +-- CaseHistory[]        (append-only)
    |           +-- AutomationBinding    (identifier or name match)
    +-- SharedStep
    +-- TestPlan  (named case selection)
    +-- Environment / Configuration
    +-- Release
    +-- Run  (from a plan or ad hoc; has environment, optional release)
          +-- RunCase --> CaseResult
                            +-- StepResult[]
                            +-- Attachment[]     --> MinIO
                            +-- DefectLink       --> Jira issue key
                            +-- Triage (state, signature)
    +-- Membership (user x project x role)
```

## Goals / Non-Goals

**Goals:**

- One datastore, one permission model, one deployment unit set — no subsystem may have a
  private path to data that bypasses role checks.
- Ingestion that a CI job can drive with a token and a curl, with no client library to
  distribute or version.
- Automation coverage numbers whose accuracy is observable, so degradation is visible
  rather than silent.
- A structure that survives moving to Kubernetes without rework.

**Non-Goals:**

- Any analytical datastore, replication pipeline, or warehouse mirror.
- Per-framework result reporters or a distributed CLI tool.
- Bidirectional Jira synchronisation.
- Real-time collaborative editing.
- Multi-tenancy beyond per-project membership.

## Decisions

### 1. Postgres as the sole datastore; Exasol removed from scope

**Decision.** Postgres holds all application data. No Exasol component is deployed.

**Why.** The initial direction was to use Exasol. Exasol is a columnar MPP analytical
engine, and the properties that make it excellent at aggregation make it a poor
transactional store: single-row writes carry high per-statement overhead, updates are
effectively rewrites, isolation is serializable-only so concurrent writers conflict rather
than merge, there is no BLOB type, no full-text search, and no ORM or query-builder
support in the TypeScript ecosystem — the data access layer and its migration tooling
would have been built and owned in-house indefinitely.

The counter-argument was that roughly half the acceptance criteria are analytical
(coverage, release readiness, flakiness, trends) and Exasol handles those natively. That
argument was tested against the scale envelope and does not bind: ~36M narrow rows with
monthly partitioning is comfortable for Postgres, and Exasol's advantage begins
materially above this volume.

**Alternatives considered.** (a) Exasol-only with an append-only schema and a single-writer
micro-batching queue — viable, but it purchases nothing at this scale while costing the
entire data access layer. (b) Postgres for OLTP with an Exasol analytical mirror — the
conventional split, and defensible, but it introduces a replication pipeline and a second
store to operate before either is needed. Explicitly rejected for v1; the append-only
result table leaves this available later as a replay of one table.

### 2. Suite tree plus free-form tags

**Decision.** The suite tree carries product, component, and module. Release stream, test
level, and customer workflow are expressed as tags. Tags are normalised on write
(lowercase, trim, collapse internal whitespace) and existing tags are offered as
suggestions during entry.

**Why.** AC 1 names six organisational axes; a tree expresses one. Tags cover the
remaining five at the lowest build cost and let teams introduce axes not anticipated here.

**Trade-off accepted.** Free-form tags are not validated, so filter accuracy depends on
convention rather than enforcement. Normalisation and suggestions are the mitigation, and
they address the common failure (`e2e` / `E2E` / `end-to-end`) without an admin UI.

**Alternatives considered.** Typed facets with admin-managed vocabularies — more reliable
filtering, since coverage reporting groups by these values, but requires vocabulary
administration. Facets-only with no tree — most honest to six orthogonal axes, rejected as
too unfamiliar for users arriving from Qase.

### 3. Coverage means automation coverage only

**Decision.** Coverage reports which managed cases lack an automation binding. There is no
Requirement or Feature entity, so the system cannot report features that have no test
cases at all.

**Why.** This is AC 3's literal wording, it falls out of the schema as a join, and it
requires no external integration. The alternative — feature-level gap tracking — needs a
Requirement entity, a Jira sync, and a linking workflow that must be maintained
indefinitely, which is where such efforts historically fail.

**Consequence.** A brand-new feature with zero test cases reads as fully covered. Adding
the second gap type later is additive: a new table and a join table, not a remodelling.

### 4. Name-match binding with a promotion path

**Decision.** An automated test binds to a managed case by explicit case identifier when
one is declared, otherwise by fully-qualified test name. Each binding records how it was
established and when it was last matched. Name-based and stale bindings are reported.

**Why.** Requiring annotations on every existing automated test before coverage shows
anything real is a migration project that blocks the whole value of AC 3. Name matching
works on day one with no repo changes. The failure mode of pure name matching — a rename
silently drops coverage and nobody is told — is addressed not by avoiding it but by making
it observable.

**Why this matters more than it appears.** With Decision 3 in force, the automation
binding is the *entire* coverage signal; there is no second measure to cross-check it.
Binding accuracy is therefore load-bearing, which is why confidence and staleness are
specified requirements rather than a nice-to-have.

**Rejected.** Auto-creating a case for any unrecognised test. Coverage would read near
100% and mean nothing, and the managed repository would fill with cases having no owner,
priority, or expected results — directly against AC 1.

### 5. Jira by outbound deep link only

**Decision.** A failed step or case records a Jira issue key, rendered as a link. No Jira
API calls are made in either direction.

**Why.** No Jira credentials, service account, polling job, or webhook infrastructure.

**Accepted gap.** AC 4's "open defects with useful breakdowns such as severity and age" is
not met: without reading Jira, the system cannot know whether a linked defect is still
open or what severity it carries. Recording severity locally at link time was considered
and rejected — it would drift from Jira immediately and present a number that is quietly
wrong, which is worse than presenting nothing. `metrics-dashboards` therefore specifies
age bands based on when the *link* was created, which is a fact the system actually owns.

### 6. Per-project role-based access control

**Decision.** A membership table maps user × project × role over a fixed set:
administrator, lead, tester, viewer. Every permission decision resolves through it. No
account is privileged by identity.

**Why.** AC 9 calls out that the legacy system had admin permissions partly hardcoded, and
AC 5 requires business-user participation in UAT — which demands scoping a user to a
single project. Global roles cannot express that. Custom permission sets were rejected:
v1 would ship four presets regardless, which is this decision with an admin UI attached.

### 7. Local accounts behind a pluggable provider

**Decision.** Local credentials with JWT sessions, implemented behind an `AuthProvider`
interface. The user record carries provider and external identifier from day one. Scoped,
revocable API tokens serve machine access.

**Why.** Ships without an IdP dependency and onboards business users without corporate IT.
The provider interface means adding OIDC later is a configuration and adapter change
rather than a migration touching sessions, roles, and attribution.

**Accepted gap.** AC 9's enterprise SSO is not met in this change. The gap is deferred and
structurally prepared for, not designed away. Note that scoped API tokens are required by
AC 2 regardless of how humans authenticate, so they are built either way.

### 8. JUnit XML posted to a plain endpoint

**Decision.** CI posts a JUnit XML document with a bearer token and metadata fields
(release, environment, commit SHA, branch). No CLI tool, no per-framework reporters. The
run is created automatically with no approval step.

**Why.** JUnit XML is the common denominator that both Pytest and Playwright emit, so one
parser covers AC 2's named frameworks. Nothing to distribute, version, or install; any
runner in any language can integrate with an HTTP call.

**Accepted gaps.** JUnit XML carries no attachment mechanism, so AC 5's "engineers can
inspect evidence generated by automated runs" is not met — screenshots, traces, and logs
have nowhere to live. It also carries no retry information, so within-run flake detection
is unavailable; Decision 20 recovers cross-run detection.

**Metadata is not optional.** Without `release`, AC 4 cannot attribute runs to releases at
all, so the endpoint accepts these fields as first-class input rather than inferring them.

### 9. Runs execute the latest case version; history is retained but not pinned

**Decision.** `CaseHistory` records every change to a case, satisfying AC 1. Runs reference
the case, not a specific version — a run always renders current content.

**Why chosen.** Testers never execute stale content, and a correction to a broken case
applies immediately to in-flight runs.

**Trade-off, stated plainly.** Execution evidence is not reproducible: a result reading
"passed step 3" cannot be tied to the step 3 that was actually executed. Nothing in the
acceptance criteria requires this, so it is an accepted consequence rather than a gap.

**This compounds with Decision 12 (shared steps).** Editing a shared step mutates the
rendered content of every in-flight run referencing it, across all projects — a fan-out
that plain cases do not have. Mitigation: the shared step editor displays how many cases
and open runs are affected before an edit proceeds (specified in `test-repository`).

**Reversibility.** Adding a `case_version_id` foreign key to `run_case` later is one
column, because the history table exists regardless.

### 10. MCP read + write, in-process, enforcing caller RBAC

**Decision.** The MCP server is mounted at `/mcp` inside the backend container. It calls
the same service layer as the REST API and resolves the same per-project roles.

**Why in-process.** AC 8 requires "appropriate security and permission boundaries." A
separate MCP container with direct database access would sit outside the application's
permission layer and require reimplementing every check — two copies that will drift. A
separate container calling the REST API preserves correctness but adds a network hop, a
fifth container, and coordinated deploys, for independent scalability that ~100 users do
not need.

**Why write access.** Agents can draft cases from a specification and record results.

**Risk accepted.** Agent-authored content enters the managed repository with no human gate.
Mitigation is provenance rather than prevention: every write records the acting user and
originating interface, so agent-authored content is filterable and auditable. A draft/publish
gate was considered and deferred — it adds a case state, a review UI, and filtering rules
throughout.

### 11. Flat twelve-month retention

**Decision.** All execution history older than twelve months is deleted. One rule, no
carve-outs by asset type. Managed test assets — cases, suites, shared steps, plans, and
their history — are never removed by retention.

**Why.** Simple to state, to audit, and to implement, which is what AC 1's "clearly
defined" asks for. Twelve months covers roughly four quarterly releases.

**Accepted gaps.** Trend views cannot look back beyond twelve months. UAT sign-off evidence
is subject to the same window, with no audit carve-out, because tiered retention was
considered and declined. If an audit requirement emerges that reaches further back, the
window is configurable and the tiering design is available.

**Attachments follow their run**, and MinIO's object lifecycle policy must mirror the
window or files will outlive the rows referencing them.

### 12. Full Qase concept set in scope

**Decision.** Test plans, shared steps, custom fields, and environments/configurations are
all in v1, alongside releases which AC 4 requires regardless.

**Why.** Each answers a real need: plans prevent rebuilding the same selection every cycle
(AC 5's "repeated release cycles"), shared steps are a significant authoring win at 25,000
cases, environments make AC 2's mixed execution environments first-class.

**Risk.** This is the single largest scope driver in the change. See Risks.

**Convention needed.** Custom fields and free-form tags overlap as case-metadata
mechanisms. The intended split is tags for filtering dimensions, custom fields for
structured data. Without a stated convention teams will use them interchangeably and both
will become noisy.

### 13. Optimistic concurrency with polling

**Decision.** Result writes carry the version they were based on; a stale write is rejected
and the conflicting value is shown before the tester confirms. Run views poll for progress.

**Why.** Last-write-wins is a correctness bug in UAT, not an inconvenience — one tester's
pass silently overwriting another's fail is exactly the failure that discredits a release
sign-off. Real-time push via SSE would give a better group-UAT experience but requires
connection lifecycle management, backpressure, and either sticky sessions or a pub/sub
layer — and would still need the same conflict rules underneath. Polling is adequate for
the handful of testers realistically inside one run.

### 14. MinIO for attachments, in all environments

**Decision.** Attachments are stored in MinIO, deployed in development and production
alike. Postgres holds metadata only.

**Why.** No dependency on corporate IT to provision a bucket, and identical behaviour in
every environment. Because Decision 8 removes automated evidence from scope, the only
files are human-created screenshots and logs — single-digit GB per year.

**Operational consequence.** Storage durability is now owned in-house: backups,
replication, and capacity. Single-node MinIO is a single point of failure for evidence
that may be wanted at audit time. Its lifecycle policy must be kept aligned with Decision
11.

**Considered.** Postgres `bytea` would have removed a container entirely and is defensible
at this volume, but bloats every backup and is awkward to reverse if automated evidence
returns to scope.

### 15. Failure triage with signature-based carry-forward

**Decision.** Failures carry a triage state (new, investigating, known issue, flaky,
resolved). A signature derived from the bound case and normalised failure output
identifies recurrences, and a matching recurrence inherits the prior state automatically.

**Why.** AC 6 requires ingestion "without requiring manual approval or reconciliation for
normal operation." Without carry-forward, every import re-triages the same known failures
from zero — unworkable at 100,000 results per day. Carry-forward is what makes AC 6 true
in practice rather than only at the upload step.

**Secondary benefit.** This partially recovers the flakiness gap from Decision 8. With
signatures tracked across runs plus an explicit flaky state, a test alternating pass/fail
on the same commit is detectable. Within-run retry detection remains unavailable.

**Risk.** A signature rule that is too coarse hides genuine new breaks inside an existing
known-issue group. A rule too fine defeats carry-forward. Recurrence of a signature
previously marked resolved is specified to surface as a regression rather than silently
inheriting the resolved state.

### 16. Manual sign-off gate

**Decision.** Each release carries a checklist of named sign-off items marked complete by
designated approvers. The system records who approved what and when; it computes no
pass/fail gate.

**Why.** Matches how go/no-go meetings actually run, and produces a clean approval audit
trail. Computed rules were considered — they make the argument explicit and reviewable —
but become negotiable under deadline pressure.

**Consequence.** Gate status reflects approvals, not evidence: an approver can sign off
while the pass rate is poor. Mitigated by displaying pass rate, blocking failure count,
and coverage summary alongside the gate, so approval is made against visible evidence.
AC 4's "visible in one place" holds.

### 17. React 19 + Vite + TanStack on the frontend

**Decision.** React with TanStack Router, Query, and Table.

**Why.** A TCMS is unusually table-dense — case grids at 25,000 rows, run execution views,
coverage matrices — and React has the strongest virtualised table ecosystem. It uses no
decorators, so it carries no TypeScript 7 native-compiler risk. Angular was rejected
primarily on that basis: it is decorator-based end to end and would require resolving
`emitDecoratorMetadata` support before any commitment.

### 18. Fastify + Zod on the backend

**Decision.** Fastify with Zod schemas, deliberately decorator-free.

**Why.** Avoids the TypeScript 7 decorator question entirely, which rules out NestJS.
Zod schemas are shared with the frontend, so request and response contracts have a single
definition.

### 19. Drizzle ORM

**Decision.** Drizzle with `drizzle-kit` for migrations, dropping to raw SQL for dashboard
queries.

**Why.** Schema defined once in TypeScript with types flowing from it, migrations included
rather than bolted on, and a first-class raw-SQL escape hatch — which matters because the
coverage matrix, flakiness, and release-readiness queries will never be expressible in a
builder. Kysely was a close second and handles complex SQL more gracefully with lighter
types, but leaves migrations a separate decision. Prisma was rejected because the queries
that matter most here fall to `$queryRaw`, losing the type safety being paid for.

**Verified (task 1.1).** Drizzle 0.45.2 typechecks and emits cleanly under the TypeScript
7.0.2 native compiler with `strict`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`. A 22-assertion type-level harness over a representative TCMS
schema confirms inference is genuinely preserved rather than collapsing to `any`: narrowed
column enums, `$type<>()` jsonb overrides, insert-type optionality, aggregate projection
shapes, and the nested relational `with` tree all infer correctly. A negative control
confirmed the harness detects failures. Typecheck 0.22s, emit 0.26s. Kysely fallback not
needed.

Three configuration requirements follow from the spike and are non-optional:

- `skipLibCheck: true` — Drizzle ships type declarations for dialects it does not require
  as installed dependencies (`gel`, `mysql2`), which fail library type checking regardless
  of this project's usage.
- `rootDir` must be set explicitly when emitting; TypeScript 7 raises TS5011 without it
  where TypeScript 5 inferred it.
- `"type": "module"` in every package, given `NodeNext` with `verbatimModuleSyntax`.

**Verified under load (task 6.12).** A full day of the design's envelope — 100,000 results
as 200 CI-sized reports at concurrency 6 — ingests in 10.8s at 9,265 results/second, with
per-upload latency of p50 306ms / p95 390ms / p99 544ms for a 500-test report. Rows route to
the correct monthly partition. Storage measures 289 bytes per result row, projecting to
**~10 GB for the 36M rows** a 12-month window holds at this rate. That is comfortable for a
single Postgres instance and confirms the sizing argument Decision 1 rests on.

**A concurrency bug this exposed.** The first version resolved the release and environment
by name with check-then-insert. Under concurrent uploads — several CI jobs finishing at once
and all pushing the first results for a *new* release — every writer but one failed on the
unique constraint, producing 3 failed uploads out of 200. Both lookups are now idempotent
upserts that read the id back afterwards, so losing writers adopt the winner's row. This is
covered by a regression test that fires eight simultaneous uploads for one new release.

### 20. Results partitioned by month; matviews only where measured

**Decision.** The result table is partitioned by month from the outset. Dashboards query
raw data, with a materialized view introduced per panel only where measurement shows it is
needed. No rollup pipeline.

**Why.** ~36M rows in steady state is comfortable for partitioned Postgres. Retention
becomes a partition drop rather than a mass delete. Building rollups before measuring
would be speculative work that also makes dashboards stale by design.

**Measured (task 8.5), and it found a real defect.** Against the full envelope — 25,000
cases, 100,903 automation bindings, 210,506 results — the coverage summary initially took
**216,906ms** and timed out at the reverse proxy. `EXPLAIN ANALYZE` showed a sequential scan
of `run_case` executed once per case (23,000 loops × 210,506 rows ≈ 4.8 billion row
examinations).

The cause was a missing index. Coverage asks "has this case ever been executed?", a lookup
that leads with `case_id`, but `run_case` was indexed only on `(run_id, case_id)` and
`(run_id, outcome)` — neither of which can serve it. Adding `run_case_case_ix` on
`(case_id)` alone took the same query to **70ms**, a 3,000-fold improvement.

Post-fix latency at full scale:

| Query | p50 |
|---|---|
| Coverage summary | 69ms |
| Grouped by tag | 145ms |
| Grouped by suite | 141ms |
| Filtered by release | 7ms |
| Uncovered drill-through | 24ms |

**No materialized view is warranted.** That was the condition this decision set, and
measurement answers it: the raw queries are comfortably fast once indexed. The general
lesson is that composite indexes do not serve lookups on a non-leading column, and this
should be checked for the remaining reporting groups rather than assumed.

**Dashboards measured (task 11.6), and the answer is no materialized views.** Every
reporting panel at the full envelope — 25,000 cases, 210,554 results, 100,903 bindings:

| Panel | p50 |
|---|---|
| Case list page | 13ms |
| Release readiness | 25ms |
| Uncovered drill-through | 26ms |
| Triage list | 41ms |
| Automation bindings | 46ms |
| Coverage summary | 73ms |
| Runs list | 115ms |
| Coverage grouped | 142–153ms |
| Metrics (30/90/365d) | 597–674ms |

Measurement found one real defect. The automation binding report loaded all 100,903 rows to
render 300, tallying the summary in JavaScript: **936ms p50**, and two orders of magnitude
more data on the wire than the view showed. Counting with SQL aggregates and returning a
bounded, server-filtered page took it to **46ms** — a twentyfold improvement — and the list
is now ordered stale-and-fragile-first so the bindings that need attention cannot fall off
the truncated end.

### 21. Export via UI download and paginated REST

**Decision.** CSV and JSON export from any filtered view, plus a paginated REST endpoint.
Both enforce the caller's project roles.

**Why.** Satisfies AC 1 with no new infrastructure and lets testers self-serve. A read-only
database role with reporting views was considered and rejected for v1: it bypasses
application RBAC entirely, so the role would see every project regardless of membership.

**A reverse-proxy limit that masked the application's own (found in task 9.5).** nginx
defaults `client_max_body_size` to 1MB. Every request body above that was rejected at the
proxy with an HTML 413 that never reached the backend, so the configured 25MB attachment
limit and 32MB ingest limit were both unreachable, and a JSON client received an unparseable
HTML page instead of an error it could act on. The proxy limit is now set above both
application limits, and request buffering is disabled on `/api/` so the application produces
its own JSON error. The general point: a limit configured in the application is only real if
every hop in front of it permits at least as much.

### 22. Compose now, Kubernetes-ready

**Decision.** Docker Compose on a single VM. The application is built twelve-factor: all
configuration from environment variables, no state on container filesystems, health and
readiness endpoints on every service, and a stateless backend with sessions in Postgres.

**Why.** Sufficient at this scale, and keeps development and production nearly identical —
which matters because Postgres and MinIO are both self-hosted. The twelve-factor
constraints are good practice regardless and make a later cluster move packaging work
rather than surgery.

**A crash on database restart, found in task 14.2.** Stopping Postgres killed the backend
process outright: `pg` emits an `error` event on *idle* clients when the server closes their
connections, and Node treats an unhandled `error` event as fatal. A routine database
restart — maintenance, an upgrade, a failover — therefore took the API down rather than it
reconnecting. The pool now carries an error listener; it discards the broken client and
opens a new one on the next query. Verified end to end: with Postgres stopped and restarted,
liveness stays up, readiness reports `unreachable` and then recovers, and Docker reports
zero restarts.

**Accepted.** A single host is a single point of failure, and upgrades involve a brief
outage.

### 23. Biome for linting and formatting, not ESLint

**Decision.** Biome provides both linting and formatting, replacing ESLint and Prettier.

**Why — discovered during task 1.4, not anticipated in planning.** The `typescript` npm
package at version 7 exports only `version` and `versionMajorMinor`. It is a launcher for
the Go compiler binary and ships **no JavaScript compiler API** — `createProgram`,
`createSourceFile`, `TypeChecker`, `SyntaxKind`, and `forEachChild` are all absent.
typescript-eslint depends on that API for type-aware rules and declares a peer range of
`typescript >=4.8.4 <6.1.0`; no published version supports TypeScript 7. Forcing the peer
resolution would fail at runtime rather than merely warn.

Biome parses TypeScript itself in Rust, has no `typescript` peer dependency, and covers
both roles in one tool.

**Consequence.** Type-aware lint rules are unavailable — no rule can consult the type
checker. Biome's rules are syntactic. The strict compiler settings (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) carry more of the correctness
burden as a result, which is part of why they are enabled.

**Wider implication for later tasks.** Any tool that introspects TypeScript through the
compiler API is unavailable under TypeScript 7. This should be checked before adopting
any codegen, documentation, or analysis tool in later work.

## Risks / Trade-offs

**Scope is the dominant risk.** → Test plans, shared steps, custom fields,
environments/configurations, triage with carry-forward, and release sign-off are all in
v1. This is a multi-quarter build. Agree phasing before committing a date; `tasks.md`
sequences work so that a coherent subset (repository, ingestion, coverage) can ship first.

**Shared steps under a no-pinning execution model.** → A shared-step edit mutates every
in-flight run referencing it, across all projects. Mitigated by showing affected case and
open-run counts before an edit; fully resolved only by adding version pinning, which is
one column away.

**Automation binding is the sole coverage signal.** → With no Requirement entity, nothing
cross-checks it. Mitigated by making binding method and staleness first-class reported
data so decay is visible rather than silent.

**Failure signature tuning.** → Too coarse hides real breaks; too fine defeats
carry-forward. Mitigated by treating recurrence-after-resolved as a regression, and by
keeping the signature rule configurable so it can be tuned against real failure output.

**Drizzle under TypeScript 7.** → Heavy type-level machinery on a new compiler. Mitigated
by verifying it as the first implementation task; Kysely is the fallback and the data
access layer should not leak the choice into service code.

**Self-hosted MinIO durability.** → Evidence needed at audit time sits on a single node.
Mitigated by including MinIO volumes in host backups; revisit if audit requirements harden.

**Four acceptance criteria knowingly unmet.** → AC 4 defect breakdowns, AC 5 automated
evidence, AC 7 in-run flake data and long-range trends, AC 9 enterprise SSO. Each is a
recorded decision with a stated reversal path, not an oversight. See `proposal.md` —
Deliberate scope limits.

## Migration Plan

No migration. Greenfield deployment with no existing data contract to honour.

The legacy Django platform is not migrated by this change, and no data is imported from
it. If historical test cases must be carried over, that is a separate change: the twelve-
month retention window means historical *execution* data has limited value, while case
definitions would need mapping onto the suite tree and tag taxonomy established here.

Rollback is deployment rollback — reverting container images and, if a migration has run,
applying its down migration. The system has no external write side effects: Jira is
link-only and CI uploads are inbound, so a rollback cannot leave inconsistent state in any
other system.

## Open Questions

- **Failure signature normalisation rule.** Which parts of failure output are normalised
  (timestamps, memory addresses, paths, line numbers) affects carry-forward precision. The
  requirement is fixed; only the rule needs tuning against real Pytest and Playwright
  output, and it is configurable by design.
- **Attachment size limit.** A concrete maximum is needed before the upload path ships; it
  does not affect the specs or the approach.
- **Sign-off approver designation.** Whether approvers are named per release or derive from
  a project role. Both satisfy the specified requirement; the choice can be made when the
  release view is built.
