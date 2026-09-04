Sequenced so that a coherent subset ships first: groups 1-8 deliver the central repository,
CI ingestion, and coverage reporting — the core of AC 1, 2, 3 and 6. Groups 9-13 add manual
execution, release reporting, MCP, and data lifecycle. Group 1.1 gates the stack choice and
must complete before any other work begins.

## 1. Toolchain and project skeleton

- [x] 1.1 Spike: build a throwaway schema with Drizzle and confirm it typechecks and builds cleanly under the TypeScript 7 native compiler; record the result and fall back to Kysely if it fails (design Decision 19)
- [x] 1.2 Create the monorepo layout (frontend, backend, shared) with TypeScript 7 configured, and verify a clean typecheck and build in every package
- [x] 1.3 Set up the shared package for Zod schemas consumed by both frontend and backend, and verify a schema imported from both sides typechecks
- [x] 1.4 Add linting, formatting, and a test runner, and verify they run from a single root command
- [x] 1.5 Create the CI workflow running typecheck, lint, and tests on pull requests, and verify it passes on an empty skeleton
- [x] 1.6 Write the Docker Compose file with frontend, backend, postgres, and minio services, and verify `docker compose up` brings all four to a healthy state

## 2. Data model and migrations

- [x] 2.1 Define the project, user, and membership schema with migrations, and verify migrations apply and roll back cleanly against an empty database
- [x] 2.2 Define the suite tree and test case schema including steps, tags, and automation status, and verify a nested suite with cases can be inserted and queried
- [x] 2.3 Define shared step and custom field schema, and verify a case can reference a shared step and carry a custom field value
- [x] 2.4 Define the case history table with actor, timestamp, changed fields, and originating interface, and verify an insert records all four
- [x] 2.5 Define test plan, environment, and release schema, and verify a plan selecting cases can be created and read back
- [x] 2.6 Define run, run case, case result, and step result schema, and verify a run with results can be inserted and queried
- [x] 2.7 Define attachment metadata, defect link, and triage schema, and verify each attaches to the correct result
- [x] 2.8 Define the automation binding schema with binding method, last-seen timestamp, and confidence, and verify both binding methods can be represented
- [x] 2.9 Partition the result table by month and verify a partition can be attached and detached without touching other partitions (design Decision 20)
- [x] 2.10 Add a seed script producing a representative dataset, and verify it loads into a fresh database in under a minute

## 3. Authentication and access control

- [x] 3.1 Implement the `AuthProvider` interface with a local credential provider, and verify sign-in succeeds with valid credentials and fails without disclosing account existence
- [x] 3.2 Store credentials as salted one-way hashes and verify no code path can read a credential back
- [x] 3.3 Implement JWT session issuance and validation with sessions in Postgres, and verify a request with an expired or tampered session is rejected
- [x] 3.4 Implement scoped API token issuance, hashing, revocation, and last-used tracking, and verify the secret is shown once and never returned again
- [x] 3.5 Enforce token scope on every request and verify a token scoped to one project is rejected against another
- [x] 3.6 Implement the per-project role matrix as data consulted by a single authorisation function, and verify no permission decision anywhere bypasses it
- [x] 3.7 Enforce project visibility so a non-member request is rejected without disclosing the project's existence, and verify via an integration test
- [x] 3.8 Implement write attribution recording acting user and originating interface on every write, and verify records created via web, REST, and MCP paths are distinguishable
- [x] 3.9 Build the sign-in, sign-out, and account screens, and verify a full sign-in to authenticated view flow in the browser
- [x] 3.10 Build the project membership administration screen, and verify an administrator can assign and revoke roles

## 4. Test repository

- [x] 4.1 Implement suite tree CRUD with nesting, and verify creating, renaming, moving, and deleting suites preserves case membership
- [x] 4.2 Implement test case CRUD with full metadata, and verify a case with no steps is rejected
- [x] 4.3 Implement tag normalisation on write and verify "  End-To-End  " converges onto an existing "end-to-end" tag without creating a second
- [x] 4.4 Implement tag suggestion lookup and verify existing tags are offered while typing
- [x] 4.5 Implement shared step CRUD and case references, and verify an edit to a shared step propagates to every referencing case
- [x] 4.6 Implement the affected-scope calculation for shared steps and verify the editor reports referencing case and open run counts before an edit (design Decision 9)
- [x] 4.7 Implement custom field definitions and values with filtering, and verify removing a definition warns with the affected case count
- [x] 4.8 Record a case history entry on every case mutation and verify three edits produce three entries with correct actors and changed fields
- [x] 4.9 Verify case history survives a rename and a suite move, via an integration test
- [x] 4.10 Build the case list view with virtualised rendering, and verify it stays responsive at 25,000 rows
- [x] 4.11 Build the case detail and edit view including steps, shared steps, tags, and custom fields, and verify a round-trip edit persists correctly
- [x] 4.12 Build the case history view and verify it renders entries with actor, timestamp, and originating interface

## 5. Test planning

- [x] 5.1 Implement test plan CRUD with case selection, and verify a plan can be created and its selection read back
- [x] 5.2 Implement run creation from a plan and verify editing the plan afterwards leaves existing runs unchanged
- [x] 5.3 Implement environment and configuration CRUD, and verify a run records its environment
- [x] 5.4 Implement release CRUD and run attribution, and verify a run created without a release is accepted and excluded from release views
- [x] 5.5 Build the plan, environment, and release management screens, and verify each supports create, edit, and delete

## 6. Result ingestion

- [x] 6.1 Implement the JUnit XML parser and verify it handles reports produced by both Pytest and Playwright, including nested suites and error elements
- [x] 6.2 Verify a malformed document is rejected atomically with no partial results persisted, via a test using a truncated file
- [x] 6.3 Implement the ingest endpoint accepting the document plus release, environment, commit SHA, and branch, authenticated by scoped token, and verify an unauthorised upload persists nothing
- [x] 6.4 Implement automatic run creation on upload with no approval step, and verify results are visible in coverage views immediately after the response returns
- [x] 6.5 Implement binding by explicit case identifier and verify it wins over name matching when both could apply
- [x] 6.6 Implement binding by fully-qualified test name and verify a matching name binds to the correct case
- [x] 6.7 Implement unbound result handling and verify no test case is auto-created for an unrecognised test
- [x] 6.8 Record binding method and last-seen timestamp on every match, and verify a name-bound test that begins declaring an identifier is recorded as identifier-bound while retaining its history
- [x] 6.9 Implement the stale binding report against a configurable threshold, and verify a binding unseen past the threshold is reported with its case and last-seen date
- [x] 6.10 Build the automation binding report view distinguishing fragile from stable bindings, and verify both categories render with counts
- [x] 6.11 Write the example GitHub Actions workflow snippet and verify it uploads successfully against a running instance
- [x] 6.12 Load-test ingestion at 100,000 results per day equivalent and verify ingest latency and database growth stay within expectations

## 7. Failure triage

- [x] 7.1 Implement the failure signature derivation with a configurable normalisation rule, and verify equivalent failures of the same test produce one signature while materially different output produces two
- [x] 7.2 Implement triage states and transitions with actor and timestamp, and verify each transition is persisted
- [x] 7.3 Implement automatic carry-forward on signature match, and verify a recurrence of a known issue inherits its state without human action
- [x] 7.4 Implement regression detection and verify a recurrence of a resolved signature surfaces as a regression rather than inheriting resolved
- [x] 7.5 Report new versus carried-forward failure counts per run, and verify the two are reported separately
- [x] 7.6 Build the triage view for a run, and verify a user can change a failure's state and see the counts update

## 8. Coverage reporting

- [x] 8.1 Implement the coverage query returning automated, manual, and never-executed counts, and verify the three sum to the total managed cases in scope
- [x] 8.2 Implement coverage filtering by suite, tag, custom field, and release, and verify combined filters narrow results correctly
- [x] 8.3 Implement coverage grouping by tag with an explicit untagged group, and verify untagged cases are reported rather than omitted
- [x] 8.4 Build the coverage view with drill-through to the uncovered case list, and verify the drill-through lists exactly the cases counted
- [x] 8.5 Measure coverage query performance against the seeded dataset and add a materialized view only if measurement shows one is needed (design Decision 20)

## 9. Manual execution

- [x] 9.1 Implement run execution endpoints for case and step level results, and verify a case result is derivable from its step outcomes
- [x] 9.2 Implement run resumption and verify returning to a partially executed run resumes at the first case without a result
- [x] 9.3 Implement optimistic concurrency on result writes and verify a stale write is rejected rather than silently overwriting
- [x] 9.4 Implement run progress polling and verify a second tester's view updates without a manual reload
- [x] 9.5 Implement attachment upload to MinIO with the configured size limit, and verify an oversized upload is rejected leaving no partial object
- [x] 9.6 Implement attachment retrieval scoped to the caller's project role, and verify a non-member cannot retrieve an attachment
- [x] 9.7 Implement defect link recording with issue key format validation, and verify an invalid reference is rejected with the expected format stated
- [x] 9.8 Build the run execution view optimised for repeated keyboard-driven execution, and verify a tester can complete a case without using the mouse
- [x] 9.9 Build the conflict resolution prompt showing the other tester's result, and verify it appears on a rejected stale write
- [x] 9.10 Verify the execution flow end to end with two concurrent sessions in one run, via an integration test

## 10. Release readiness

- [x] 10.1 Implement the release aggregate progress query, and verify a release with no runs reports absence of data rather than zero failures
- [x] 10.2 Implement blocking failure identification distinguishing untriaged from known and flaky, and verify known issues are excluded from the blocking count
- [x] 10.3 Implement the release defect link listing, and verify each entry links to both Jira and the originating failure
- [x] 10.4 Implement UAT run designation and status reporting, and verify UAT runs are distinguishable from other runs
- [x] 10.5 Implement the sign-off checklist with designated approvers, and verify a non-approver's attempt to complete an item is rejected
- [x] 10.6 Implement gate status derivation from checklist completion, and verify outstanding items and their approvers are listed when incomplete
- [x] 10.7 Build the release readiness view presenting progress, blocking failures, defects, coverage, UAT status, and gate together, and verify all six appear without navigating away (AC 4)

## 11. Metrics and dashboards

- [x] 11.1 Implement pass rate, failure rate, runtime, and coverage metrics scoped by project, release, and period, and verify results against the seeded dataset
- [x] 11.2 Implement cross-run flakiness detection, and verify a test alternating outcomes on one commit is flagged while a consistently failing test is not
- [x] 11.3 Implement defect link age banding based on link creation time, and verify bands are correct at boundary values
- [x] 11.4 Implement trend series for pass rate, failure rate, and runtime, and verify a request beyond the retention window returns available data with an explicit statement of the limit
- [x] 11.5 Build the dashboard views, and verify each metric and trend renders against seeded data
- [x] 11.6 Measure dashboard query performance and add materialized views only for panels that measurement shows require them

## 12. MCP integration

- [x] 12.1 Mount the MCP server in-process at `/mcp` and verify a client can connect and enumerate tools
- [x] 12.2 Implement read tools for cases, suites, runs, results, coverage, and defect links, and verify coverage returned matches the web view exactly for the same project
- [x] 12.3 Implement write tools for case creation and update, run creation, result recording, and defect linking, and verify a case created via MCP is structurally identical to one created via the web interface
- [x] 12.4 Route every MCP operation through the same authorisation function as the REST API, and verify a viewer's write attempt and a non-member's read attempt are both rejected
- [x] 12.5 Verify a change to the permission matrix takes effect for MCP and the web interface simultaneously, via an integration test
- [x] 12.6 Record MCP as the originating interface on all writes, and verify agent-authored cases are filterable by provenance
- [x] 12.7 Publish MCP tool and REST API documentation covering parameters, return shapes, and required roles, and verify every exposed operation is documented

## 13. Data lifecycle

- [x] 13.1 Implement retention processing deleting execution history beyond the configured window via partition drop, and verify managed test assets are untouched
- [x] 13.2 Implement attachment deletion alongside run deletion, and verify no attachment remains in MinIO without a referencing run
- [x] 13.3 Configure the MinIO object lifecycle policy to mirror the retention window, and verify it is aligned with the database setting (design Decision 14)
- [x] 13.4 Surface the retention window in execution history and trend views, and verify it is stated wherever history is bounded
- [x] 13.5 Implement CSV and JSON export from filtered case, run, and result views, and verify an export contains exactly the filtered rows
- [x] 13.6 Enforce project role scoping on exports and verify an export excludes projects the user is not a member of
- [x] 13.7 Implement the paginated results REST endpoint with filtering, and verify paging returns every matching result exactly once with no duplicates or omissions
- [x] 13.8 Verify large exports stream rather than buffer, by exporting the full seeded result set and observing stable memory use

## 14. Deployment and operations

- [x] 14.1 Move all configuration to environment variables with no filesystem state in any container, and verify each service starts from environment alone
- [x] 14.2 Add health and readiness endpoints to frontend and backend, and verify Compose reports healthy only once dependencies are reachable
- [x] 14.3 Document the backup procedure covering Postgres and MinIO volumes, and verify a restore into a clean host reproduces working state
- [x] 14.4 Document deployment, upgrade, and rollback including down migrations, and verify a rollback to the prior image set succeeds
- [x] 14.5 Write the operator runbook covering retention, token administration, and the staleness threshold, and verify each documented procedure against a running instance

## 15. Acceptance verification

- [x] 15.1 Walk each acceptance criterion against the running system and record met, partially met, or not met with evidence
- [x] 15.2 Confirm every gap recorded in `proposal.md` matches observed behaviour, and that no unrecorded gap exists
- [x] 15.3 Run an end-to-end rehearsal — author cases, upload CI results, triage failures, execute a manual UAT run, and complete release sign-off — and verify the release view supports a go/no-go discussion
