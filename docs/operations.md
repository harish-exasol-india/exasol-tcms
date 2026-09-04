# Operating the TCMS

Four containers on one host: `frontend` (nginx serving the SPA and proxying the API),
`backend` (Fastify, with MCP mounted in-process), `postgres`, and `minio`.

Only `postgres` and `minio` hold state. The application containers are stateless and
disposable — this is audited in CI by `scripts/check-twelve-factor.mjs`, because the claim
is only worth anything if it is checked.

---

## Deploying

```bash
cp .env.example .env          # then set the secrets below
docker compose up -d --build
docker compose exec backend node dist/db/migrate-cli.js up
```

`docker compose ps` should report all four healthy. The backend is healthy when the process
is up; it is *ready* only when Postgres is reachable — see Health below.

### Settings that must be changed before production

| Variable | Why |
|---|---|
| `COOKIE_SECRET` | Signs session cookies. The default is a development placeholder. |
| `POSTGRES_PASSWORD` | Default is `tcms`. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Default is `tcmsadmin`. |
| `CORS_ORIGIN` | Must name the real origin, not `localhost`. |
| `JIRA_BASE_URL` | Defect links point here. |

Everything else has a working default. All configuration arrives through the environment;
nothing is read from a file at runtime.

---

## Upgrading

```bash
git pull
docker compose up -d --build
docker compose exec backend node dist/db/migrate-cli.js up
```

Migrations are forward-only from `drizzle-kit`, so **every migration ships a paired down
script** in `drizzle/down/`. CI enforces this (`npm run migrations:check`); without the pair
the rollback below is fiction.

There is a brief outage while containers restart. On a single host that is inherent — see
design Decision 22.

## Rolling back

```bash
# 1. Application only (no schema change in the release):
docker compose up -d --force-recreate --pull never   # after checking out the prior tag

# 2. Application and schema:
docker compose exec backend node dist/db/migrate-cli.js down   # one migration per invocation
docker compose up -d --build
```

`migrate-cli down` reverses the most recent migration and removes its ledger row, which is
what makes it eligible to run again. Run it once per migration to unwind.

**Verified:** rolling back `0005_run_case_index` removed the index and left all 25,000 cases
and 210,554 results intact; rolling forward restored it.

The system has no outbound write side effects — Jira is link-only and CI uploads are
inbound — so a rollback cannot leave another system inconsistent.

---

## Backup and restore

```bash
scripts/backup.sh /srv/backups/tcms          # nightly, via cron
scripts/restore.sh /srv/backups/tcms/<stamp> --confirm
```

The backup captures the Postgres database (a logical `pg_dump`, restorable across versions)
and the MinIO attachment bucket. **Take them together**: results reference attachment
objects, so restoring one without the other leaves dangling references or orphans.

A manifest records case, result and attachment counts at capture time, so a restore can be
*checked* rather than hoped for.

`restore.sh` is destructive — it drops and recreates the database — and refuses to run
without `--confirm`.

**Verified:** the database was dropped entirely and restored from backup; cases, results,
attachments and all six monthly partitions matched exactly, and the application signed in
and served coverage immediately afterwards.

Container images are not backed up: they are rebuildable from the repository.

---

## Health

| Endpoint | Meaning | Use for |
|---|---|---|
| `/healthz` | The process is up. Checks no dependency. | Liveness — restart if it fails |
| `/readyz` | Postgres is reachable. Returns `503` when not. | Readiness — stop sending traffic |

The distinction matters: with Postgres down, liveness stays green and readiness reports
`{"status":"not_ready","checks":{"database":"unreachable"}}`. Restarting the application
would not help, and readiness recovers on its own once the database returns.

The connection pool carries an error listener specifically so an idle-client error during a
database restart does not kill the process. **Verified:** stopping and starting Postgres
leaves `RestartCount=0`.

---

## Retention

Execution history older than `RETENTION_MONTHS` (default 12) is deleted. Managed test
assets — cases, suites, shared steps, plans and their history — are never removed.

```bash
# Always dry-run first: it reports exactly what would go.
curl -X POST http://localhost:3000/api/admin/retention \
  -H 'content-type: application/json' -d '{"dryRun":true}' -b "$SESSION"
```

Results are removed by dropping whole monthly partitions rather than a mass `DELETE`, which
is why `case_result` is partitioned. Attachments are deleted with their runs, so no object
outlives the row referencing it; the response reports `orphanedAttachments`, which should
always be `0`.

**MinIO lifecycle must match.** If a bucket lifecycle rule is configured, set its expiry to
the same window. A shorter rule silently removes evidence the database still references.

```bash
docker compose exec minio mc ilm rule add --expire-days 365 local/tcms-attachments
```

Requires an administrator role in at least one project.

---

## API tokens

Tokens are project-scoped, revocable, and shown once at creation. They are stored only as a
SHA-256 hash — a lost token cannot be recovered, only replaced.

```sql
-- Which tokens exist and whether they are still used
SELECT p.name, t.name, t.prefix, t.created_at, t.last_used_at, t.revoked_at
FROM api_token t JOIN project p ON p.id = t.project_id ORDER BY t.last_used_at DESC NULLS LAST;

-- Revoke immediately
UPDATE api_token SET revoked_at = now() WHERE prefix = 'tcms_ab';
```

Revocation takes effect on the next request; nothing is cached.

---

## Automation binding staleness

`BINDING_STALE_DAYS` (default 30) sets when a binding is reported stale. Because there is no
Requirements model, **the automation binding is the entire coverage signal** — nothing
cross-checks it, so its decay is the thing to watch.

Review the Automation tab periodically for:

- **Name-based bindings.** These break silently when a test is renamed or moved. Declaring a
  case id in the test promotes the binding and makes it rename-proof.
- **Stale bindings.** Not matched within the threshold: either the test was deleted, or it
  stopped running, or the binding broke. All three make coverage overstate reality.
- **Unmatched tests.** Ran in CI but bind to nothing, so they count toward no coverage
  figure. No case is created for them automatically.

Lower the threshold for a project with frequent CI, raise it for one that runs weekly.

---

## Routine checks

| Frequency | Check |
|---|---|
| Daily | `docker compose ps` reports four healthy; `/readyz` returns 200 |
| Daily | Backup ran and its manifest counts look plausible |
| Weekly | Automation tab: stale and name-based binding counts are not growing |
| Weekly | Triage: the "need a decision" count is being worked down |
| Monthly | Retention dry-run matches expectations before it runs for real |
| Monthly | Restore a backup into a scratch database — an untested backup is not a backup |
| Per release | Release readiness reviewed and signed off before shipping |

---

## Known operational limits

These are deliberate scope decisions, recorded so they are not mistaken for faults:

- **Single host.** No redundancy; upgrades involve a brief outage.
- **Self-hosted MinIO.** Storage durability is yours. A single node is a single point of
  failure for evidence that may be wanted at audit time — include its volume in backups.
- **No enterprise SSO.** Local accounts only. There is no self-service account creation;
  users are provisioned against the database.
- **Jira is link-only.** Defect status and severity are not read back, so the TCMS cannot
  report whether a linked defect is still open.
