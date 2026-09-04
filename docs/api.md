# API reference

_Generated from the running application by `npm run docs:api`. Do not edit by hand._

## Authentication

Two credential kinds, both resolving to the same principal and the same per-project
permission check — there is no separate path for machines, agents, or the web interface.

| Kind | Credential | Used by |
|---|---|---|
| Session | `tcms_session` cookie (httpOnly, SameSite=Lax) | People, via the web interface |
| API token | `Authorization: Bearer tcms_…` | CI and machines |

An API token is scoped to exactly one project and to a set of scopes (`results:write`,
`results:read`, `cases:read`, `cases:write`). It is displayed once at creation and stored
only as a SHA-256 hash; it can be revoked without affecting anything else.

**Denials are undifferentiated.** A caller holding no role in a project receives `404`,
never `403`: the existence of a project is not disclosed to someone who cannot see it.

## Errors

| Status | Meaning |
|---|---|
| `400` | Validation failed, or a documented `code` such as `INVALID_REPORT` |
| `401` | No credentials, or an expired or revoked session |
| `404` | Not found, or not visible to this caller |
| `409` | Conflict. `RESULT_CONFLICT` carries `current`, the result that won |
| `413` | Upload exceeds the attachment size limit |

Error bodies may carry fields beyond `error` and `code`, so clients must not assume the
shape is closed. A `RESULT_CONFLICT` carries the competing result, which the caller needs
in order to reconcile rather than blindly retry.

## Endpoints

### Operations

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/healthz` | none |
| `GET` | `/readyz` | none |

### Authentication

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/auth/me` | none (authentication itself) |
| `POST` | `/api/auth/sign-in` | none (authentication itself) |
| `POST` | `/api/auth/sign-out` | none (authentication itself) |

### Access control

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/assignable-users` | `member.manage` |
| `GET` | `/api/projects/:projectId/members` | `case.read` to list, `member.manage` to change |
| `PUT` | `/api/projects/:projectId/members` | `case.read` to list, `member.manage` to change |
| `DELETE` | `/api/projects/:projectId/members/:userId` | `case.read` to list, `member.manage` to change |

### Test repository

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/cases` | `case.read` / `case.create` / `case.edit` / `case.delete` |
| `POST` | `/api/projects/:projectId/cases` | `case.read` / `case.create` / `case.edit` / `case.delete` |
| `GET` | `/api/projects/:projectId/cases/:caseId` | `case.read` / `case.create` / `case.edit` / `case.delete` |
| `PATCH` | `/api/projects/:projectId/cases/:caseId` | `case.read` / `case.create` / `case.edit` / `case.delete` |
| `DELETE` | `/api/projects/:projectId/cases/:caseId` | `case.read` / `case.create` / `case.edit` / `case.delete` |
| `GET` | `/api/projects/:projectId/cases/:caseId/history` | `case.read` |
| `GET` | `/api/projects/:projectId/custom-fields` | `case.read` to read, `custom_field.manage` to change |
| `POST` | `/api/projects/:projectId/custom-fields` | `case.read` to read, `custom_field.manage` to change |
| `DELETE` | `/api/projects/:projectId/custom-fields/:id` | `case.read` to read, `custom_field.manage` to change |
| `GET` | `/api/projects/:projectId/custom-fields/:id/usage` | `case.read` to read, `custom_field.manage` to change |
| `GET` | `/api/projects/:projectId/shared-steps` | `case.read` to read, `shared_step.manage` to change |
| `POST` | `/api/projects/:projectId/shared-steps` | `case.read` to read, `shared_step.manage` to change |
| `GET` | `/api/projects/:projectId/shared-steps/:id` | `case.read` to read, `shared_step.manage` to change |
| `PATCH` | `/api/projects/:projectId/shared-steps/:id` | `case.read` to read, `shared_step.manage` to change |
| `DELETE` | `/api/projects/:projectId/shared-steps/:id` | `case.read` to read, `shared_step.manage` to change |
| `GET` | `/api/projects/:projectId/suites` | `case.read` to read, `suite.manage` to change |
| `POST` | `/api/projects/:projectId/suites` | `case.read` to read, `suite.manage` to change |
| `PATCH` | `/api/projects/:projectId/suites/:id` | `case.read` to read, `suite.manage` to change |
| `DELETE` | `/api/projects/:projectId/suites/:id` | `case.read` to read, `suite.manage` to change |
| `GET` | `/api/projects/:projectId/tags` | `case.read` |

### Planning

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/environments` | `run.read` to read, `environment.manage` to change |
| `POST` | `/api/projects/:projectId/environments` | `run.read` to read, `environment.manage` to change |
| `DELETE` | `/api/projects/:projectId/environments/:id` | `run.read` to read, `environment.manage` to change |
| `GET` | `/api/projects/:projectId/plans` | `run.read` to read, `plan.manage` to change |
| `POST` | `/api/projects/:projectId/plans` | `run.read` to read, `plan.manage` to change |
| `PATCH` | `/api/projects/:projectId/plans/:id` | `run.read` to read, `plan.manage` to change |
| `DELETE` | `/api/projects/:projectId/plans/:id` | `run.read` to read, `plan.manage` to change |
| `GET` | `/api/projects/:projectId/plans/:id/cases` | `run.read` to read, `plan.manage` to change |
| `GET` | `/api/projects/:projectId/releases` | `run.read` to read, `release.manage` to change |
| `POST` | `/api/projects/:projectId/releases` | `run.read` to read, `release.manage` to change |
| `PATCH` | `/api/projects/:projectId/releases/:id|:releaseId` | `run.read` to read, `release.manage` to change |

### Execution

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/attachments/:attachmentId` | `run.execute` to upload, `run.read` to fetch |
| `DELETE` | `/api/projects/:projectId/defects/:defectLinkId` | `defect.link` |
| `GET` | `/api/projects/:projectId/runs` | `run.read` to read, `run.create` to create |
| `POST` | `/api/projects/:projectId/runs` | `run.read` to read, `run.create` to create |
| `GET` | `/api/projects/:projectId/runs/:runId` | `run.read` to read, `run.create` to create |
| `GET` | `/api/projects/:projectId/runs/:runId/cases/:runCaseId` | `run.read` to read, `run.execute` to record |
| `PATCH` | `/api/projects/:projectId/runs/:runId/cases/:runCaseId` | `run.read` to read, `run.execute` to record |
| `POST` | `/api/projects/:projectId/runs/:runId/cases/:runCaseId/attachments` | `run.execute` to upload, `run.read` to fetch |
| `POST` | `/api/projects/:projectId/runs/:runId/cases/:runCaseId/defects` | `defect.link` |
| `POST` | `/api/projects/:projectId/runs/:runId/close` | `run.close` |

### Result ingestion

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/automation/bindings` | `report.read` |
| `POST` | `/api/projects/:projectId/results/junit` | `run.create` (token scope `results:write`) |

### Triage

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/runs/:runId/triage-summary` | `run.read` to read, `triage.update` to change |
| `GET` | `/api/projects/:projectId/triage` | `run.read` to read, `triage.update` to change |
| `PATCH` | `/api/projects/:projectId/triage/:triageId` | `run.read` to read, `triage.update` to change |

### Coverage

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/coverage` | `report.read` |
| `GET` | `/api/projects/:projectId/coverage/uncovered` | `report.read` |

### Reporting

| Method | Path | Required permission |
|---|---|---|
| `GET` | `/api/projects/:projectId/metrics` | `report.read` |
| `GET` | `/api/projects/:projectId/releases/:id|:releaseId/readiness` | `report.read` |
| `POST` | `/api/projects/:projectId/releases/:id|:releaseId/sign-offs` | `release.manage` |
| `POST` | `/api/projects/:projectId/sign-offs/:signOffId/complete` | `release.sign_off` |
| `POST` | `/api/projects/:projectId/sign-offs/:signOffId/reopen` | `release.manage` |

### Data lifecycle

| Method | Path | Required permission |
|---|---|---|
| `POST` | `/api/admin/retention` | `project.settings` on some project |
| `GET` | `/api/projects/:projectId/export/cases` | `export.perform` |
| `GET` | `/api/projects/:projectId/export/results` | `export.perform` |
| `GET` | `/api/projects/:projectId/results` | `report.read` |
| `GET` | `/api/retention` | none (policy disclosure) |

### MCP

| Method | Path | Required permission |
|---|---|---|
| `POST` | `/mcp` | per tool; see the MCP section |

## MCP

The MCP server is mounted **in-process** at `POST /mcp` and speaks JSON-RPC 2.0 over
HTTP. It authenticates exactly as the REST API does, and every tool resolves the
caller's per-project role through the same authorisation function. There is deliberately
no second permission path, so a change to the role matrix takes effect for MCP and the
web interface simultaneously.

Writes are recorded with `mcp` provenance, so agent-authored content stays distinguishable
from human-authored content.

| Tool | Permission | Description |
|---|---|---|
| `list_projects` | `case.read` | List the projects the caller holds a role in. |
| `list_suites` | `case.read` | The suite tree of a project, with per-suite case counts. |
| `search_cases` | `case.read` | Search managed test cases by title or reference, optionally filtered by suite, tag, or automation status. |
| `get_case` | `case.read` | One managed test case with its steps, tags, and metadata. |
| `get_coverage` | `report.read` | Automation coverage: how many managed cases have an automated test bound, how many remain manual, and how many have never been executed. Cannot report features that have no test case at all. |
| `list_runs` | `run.read` | Test runs in a project, newest first, with execution progress. |
| `get_run` | `run.read` | One run with its cases and their current outcomes. |
| `get_failure_triage` | `run.read` | Failures and their triage state. A failure matching a previously triaged signature inherits that state automatically. |
| `get_release_readiness` | `report.read` | Everything a go/no-go discussion needs for one release: execution progress, blocking failures, linked defects, coverage, UAT status, and sign-off gate. |
| `get_metrics` | `report.read` | Quality metrics: pass rate, failure rate, runtime, coverage, flaky candidates, and defect age bands, bounded by the retention window. |
| `get_automation_bindings` | `report.read` | How automated tests map to managed cases, including which bindings are name-based (fragile) and which have gone stale. |
| `create_case` | `case.create` | Create a managed test case. Recorded with MCP provenance, so agent-authored cases are distinguishable from human-authored ones. |
| `update_case` | `case.edit` | Update a managed test case. Records a change history entry with MCP provenance. |
| `create_run` | `run.create` | Create a test run from a plan or an explicit case selection. |
| `record_result` | `run.execute` | Record an outcome for a case within a run. Requires the version last read, so a concurrent write is rejected rather than silently overwritten. |
| `update_triage` | `triage.update` | Set the triage state of a failure signature. The state carries forward automatically to later matching failures. |
| `link_defect` | `defect.link` | Link a Jira issue to a failed case in a run. The link is a reference only; Jira is never called. |

### Tool parameters

#### `list_projects`

Takes no parameters.

#### `list_suites`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |

#### `search_cases`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `search` | string | no | Match against title or reference |
| `suiteId` | string | no |  |
| `tag` | string | no |  |
| `automated` | boolean | no |  |
| `limit` | number | no |  |

#### `get_case`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `caseId` | string | yes |  |

#### `get_coverage`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `release` | string | no |  |
| `groupByTag` | boolean | no |  |

#### `list_runs`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `releaseId` | string | no |  |

#### `get_run`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `runId` | string | yes |  |

#### `get_failure_triage`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `state` | string | no |  |

#### `get_release_readiness`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `releaseId` | string | yes |  |

#### `get_metrics`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `days` | number | no |  |

#### `get_automation_bindings`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |

#### `create_case`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `suiteId` | string | yes |  |
| `title` | string | yes |  |
| `priority` | `low` \| `medium` \| `high` \| `critical` | no |  |
| `risk` | `low` \| `medium` \| `high` | no |  |
| `preconditions` | string | no |  |
| `steps` | array | yes | At least one step is required |
| `tags` | array | no |  |

#### `update_case`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `caseId` | string | yes |  |
| `title` | string | no |  |
| `priority` | `low` \| `medium` \| `high` \| `critical` | no |  |
| `risk` | `low` \| `medium` \| `high` | no |  |
| `tags` | array | no |  |

#### `create_run`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `name` | string | yes |  |
| `kind` | `manual` \| `automated` \| `uat` | no |  |
| `planId` | string | no |  |
| `caseIds` | array | no |  |
| `releaseId` | string | no |  |

#### `record_result`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `runId` | string | yes |  |
| `runCaseId` | string | yes |  |
| `outcome` | `passed` \| `failed` \| `blocked` \| `skipped` \| `untested` | yes |  |
| `basedOnVersion` | number | yes |  |
| `comment` | string | no |  |

#### `update_triage`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `triageId` | string | yes |  |
| `state` | `new` \| `investigating` \| `known_issue` \| `flaky` \| `resolved` \| `regression` | yes |  |
| `note` | string | no |  |

#### `link_defect`

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectId` | string | yes | The project to act within, given as its id or its key (e.g. "exasol-db") |
| `runId` | string | yes |  |
| `runCaseId` | string | yes |  |
| `issueKey` | string | yes |  |
| `stepPosition` | number | no |  |

