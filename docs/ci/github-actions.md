# Uploading test results from GitHub Actions

The TCMS accepts JUnit XML over HTTP with a scoped API token. There is no client library
to install and nothing to keep in step with a TCMS release: any runner that can run `curl`
can report results.

## Minimal example

```yaml
name: tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: pytest --junitxml=results.xml
        # Report results even when tests fail -- a failing suite is exactly the run the
        # TCMS most needs to see.
        continue-on-error: true

      - name: Upload results to TCMS
        if: always()
        run: |
          curl --fail-with-body --silent --show-error \
            -X POST "$TCMS_URL/api/projects/$TCMS_PROJECT_ID/results/junit\
?release=${RELEASE}&environment=ci&branch=${GITHUB_REF_NAME}&commitSha=${GITHUB_SHA}" \
            -H "Authorization: Bearer $TCMS_TOKEN" \
            -H "Content-Type: application/xml" \
            --data-binary @results.xml
        env:
          TCMS_URL: ${{ vars.TCMS_URL }}
          TCMS_PROJECT_ID: ${{ vars.TCMS_PROJECT_ID }}
          TCMS_TOKEN: ${{ secrets.TCMS_TOKEN }}
          RELEASE: ${{ vars.TCMS_RELEASE }}
```

## Playwright

Playwright emits the same format, so only the test command changes:

```yaml
      - name: Run tests
        run: npx playwright test --reporter=junit
        env:
          PLAYWRIGHT_JUNIT_OUTPUT_NAME: results.xml
```

## Query parameters

| Parameter | Required | Purpose |
|---|---|---|
| `release` | for release reporting | Attributes the run to a release. **Without it the run cannot appear in release readiness views at all.** Created on first sight. |
| `environment` | no | Named execution target (`ci`, `staging`). Created on first sight. |
| `branch` | no | Recorded on the run. |
| `commitSha` | no | Recorded on the run. Flakiness detection compares outcomes across runs of the *same* commit, so omitting it disables that signal. |
| `runName` | no | Defaults to `CI <branch> <short sha>`. |

## Authentication

Create a project-scoped token in the TCMS with the `results:write` scope and store it as a
repository secret. The token is shown once at creation and cannot be retrieved afterwards;
it is scoped to a single project and can be revoked without affecting anything else.

## Binding tests to managed cases

A result is only counted in coverage once it binds to a managed test case. Two mechanisms,
in priority order:

1. **Declared case id** (preferred, survives renames):

   ```python
   # pytest
   def test_admin_sso(record_property):
       record_property("tcms.id", "EXA-1234")
       ...
   ```

   ```ts
   // playwright -- the marker form works in any framework
   test('admin sso [EXA-1234]', async () => { ... });
   ```

2. **Fully-qualified name** (`classname::name`), used when no id is declared and a binding
   already exists. This works with no repository changes but breaks on rename or file
   move. The TCMS reports which bindings are name-based and which have not been seen
   recently, so this decay is visible rather than silent — see the automation binding
   report.

A test matching neither is retained and reported as unbound. **No test case is ever created
automatically**: the repository holds only cases someone owns.

## Response

```json
{
  "runId": "…", "runName": "CI main deadbeef", "ingested": 412,
  "bound": { "byIdentifier": 380, "byName": 12 },
  "unbound": 20,
  "counts": { "passed": 400, "failed": 9, "skipped": 3 },
  "triage": { "newFailures": 2, "carriedForward": 7, "regressions": 0 }
}
```

`triage.carriedForward` counts failures that matched a previously triaged signature and
inherited its state automatically, so a known issue does not re-alert every run.

## Failure modes

| Status | Meaning |
|---|---|
| `400 INVALID_REPORT` | The document is not well-formed JUnit XML. Nothing was persisted. |
| `401` | No credentials. |
| `404` | The token is not valid for this project, or lacks `results:write`. Project existence is not disclosed. |
