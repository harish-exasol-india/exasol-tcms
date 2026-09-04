## Why

Exasol's current test management platform is a legacy Django application that fails on
several fronts at once: local accounts only with no enterprise SSO, no practical RBAC
model, admin permissions partly hardcoded, and a weak security posture from outdated
framework and runtime choices, committed secrets, and debug-friendly settings. It also
provides no usable path for GitHub Actions result ingestion, no coverage or gap
tracking, and no release-readiness reporting.

We are building a replacement Test Case Management System (TCMS) — modelled on Qase —
that serves as the single managed repository for both manual and automated tests,
ingests automated results headlessly from CI, and produces the coverage and release
readiness views needed to support a confident go/no-go discussion.

## What Changes

This is a greenfield system. The repository currently contains no application code.

**Platform**

- TypeScript 7 across frontend and backend.
- Frontend and backend run in separate containers, alongside Postgres and MinIO.
- Postgres is the sole datastore. **An earlier direction to use Exasol as the primary
  database was evaluated and explicitly rejected** — see `design.md`, Decision 1.
- Deployment via Docker Compose, built twelve-factor so a later move to Kubernetes is
  packaging work rather than a rewrite.

**Test repository**

- Managed test cases with ownership, priority, risk, tags, preconditions, steps,
  expected results, and automation status.
- Organisation by a suite tree (product / component / module) plus free-form tags,
  normalised on write.
- Shared steps, admin-defined custom fields, and per-case change history.

**Automation and CI**

- A headless ingest endpoint accepting JUnit XML from GitHub Actions, authenticated with
  scoped API tokens, auto-creating the corresponding run with no approval step.
- Automated tests bind to managed cases by fully-qualified test name initially, with a
  promotion path to explicit case-ID annotations, and binding confidence and staleness
  surfaced so decay is visible rather than silent.

**Execution, triage and reporting**

- Structured manual runs for UAT and release validation, with evidence attachments,
  optimistic concurrency, and outbound deep links to Jira for defects.
- A failure triage flow whose state carries forward automatically across imports on a
  matching failure signature.
- Coverage reporting (which managed cases lack automation), release readiness with a
  manual sign-off checklist, and dashboards for pass rate, failure rate, runtime,
  flakiness, and open bugs.
- Read + write MCP integration enforcing the caller's per-project role.

**Deliberate scope limits.** The following acceptance criteria are knowingly not met in
this change, as recorded decisions rather than oversights:

| Criterion | Gap | Cause |
|---|---|---|
| AC 4 | Defect severity and age breakdowns | Jira is deep-link only; no state is read back |
| AC 4 | Gate is approval-based, not evidence-enforced | Manual sign-off checklist chosen over computed rules |
| AC 5 | Evidence from automated runs | JUnit XML carries no attachment mechanism |
| AC 7 | In-run retry/flake data | Cross-run flakiness detection works; within-run retries are not captured |
| AC 7 | Trends beyond 12 months | Flat 12-month retention window |
| AC 9 | Enterprise SSO | Deferred; local accounts now, OIDC pluggable behind a provider interface |

## Capabilities

### New Capabilities

- `test-repository`: managed test cases, suite tree, tags, steps, shared steps, custom
  fields, and per-case change history.
- `test-planning`: reusable test plans, environments and configurations, and
  releases/milestones that runs and reporting attach to.
- `manual-execution`: structured manual runs, step-level results, evidence attachments,
  concurrent execution semantics, and Jira defect links.
- `result-ingestion`: headless JUnit XML ingestion from CI, run auto-creation, and the
  binding of automated tests to managed cases via stable identifiers.
- `failure-triage`: triage states for failures and automatic carry-forward across
  imports on a matching failure signature.
- `coverage-reporting`: which managed cases are covered by automation and which remain
  manual or untested, filterable by suite, tag, and release.
- `release-readiness`: the release-level view of execution progress, open defect links,
  coverage gaps, UAT status, and sign-off gate status.
- `metrics-dashboards`: pass rate, failure rate, runtime, coverage, flakiness, and open
  bugs, with trend views for recurring operational review.
- `auth-and-access`: local accounts with JWT sessions behind a pluggable auth provider,
  scoped API tokens for CI, and per-project role-based access control.
- `mcp-integration`: an MCP server exposing test cases, executions, and defect-related
  data for read and write, enforcing the caller's per-project role.
- `data-lifecycle`: execution history retention and the export of results for downstream
  reporting.

### Modified Capabilities

None. This is the first change in a greenfield repository; no specs exist yet.

## Impact

**New code.** Everything. Frontend (React 19, Vite, TanStack Router/Query/Table),
backend (Fastify, Zod, Drizzle ORM), database schema and migrations, the ingest
endpoint, the MCP server mounted in-process, and the Compose deployment.

**External systems.** GitHub Actions workflows in test repositories gain an upload step.
Jira is referenced by outbound link only, so no Jira credentials or API access are
required. No identity provider integration is required for this change.

**Infrastructure.** One VM running four containers. MinIO durability, backups, and an
object lifecycle policy mirroring the 12-month retention window become an operational
responsibility.

**Risks.**

1. **Scope.** Test plans, shared steps, custom fields, environments/configurations,
   triage with carry-forward, and release sign-off are all in scope. This is a
   multi-quarter build; phasing should be agreed before any date is committed.
2. **Shared steps under a no-pinning execution model.** Runs execute the latest case
   version, so editing a shared step mutates the content of every in-flight run that
   references it, across all projects. See `design.md`, Decision 9.
3. **TypeScript 7 toolchain.** Drizzle's type-level machinery must be confirmed to
   compile under the native compiler before it is committed to.
