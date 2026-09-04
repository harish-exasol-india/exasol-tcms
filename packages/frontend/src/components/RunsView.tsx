import { useState } from 'react';
import { useCreateRun, useEnvironments, usePlans, useReleases, useRuns } from '../lib/execution.js';
import { RunExecution } from './RunExecution.js';

/** Run list, run creation, and the planning vocabulary behind them (tasks 5.5, 9.8). */
export function RunsView({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (activeRun) {
    return (
      <RunExecution projectId={projectId} runId={activeRun} onBack={() => setActiveRun(null)} />
    );
  }

  return (
    <div style={{ padding: 16 }} className="binding-report">
      <div className="toolbar">
        <h2 style={{ margin: 0, fontSize: 16 }}>Test runs</h2>
        <span style={{ flex: 1 }} />
        {canManage ? (
          <button type="button" data-testid="new-run" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Cancel' : 'New run'}
          </button>
        ) : null}
      </div>

      {creating ? (
        <CreateRunForm
          projectId={projectId}
          onCreated={(id) => {
            setCreating(false);
            setActiveRun(id);
          }}
        />
      ) : null}

      <RunList projectId={projectId} onOpen={setActiveRun} />
      <PlanningPanel projectId={projectId} canManage={canManage} />
    </div>
  );
}

function RunList({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const runs = useRuns(projectId);
  if (runs.isPending) return <p className="muted">Loading runs…</p>;
  if (!runs.data?.runs.length) return <p className="muted">No runs yet.</p>;

  return (
    <div className="card" style={{ padding: 0 }}>
      <table data-testid="runs-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Kind</th>
            <th>Release</th>
            <th>Environment</th>
            <th>Progress</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.data.runs.slice(0, 100).map((run) => {
            const executed = run.progress.total - run.progress.untested;
            return (
              <tr key={run.id} data-testid={`run-row-${run.id}`}>
                <td>
                  <button type="button" className="link" onClick={() => onOpen(run.id)}>
                    {run.name}
                  </button>
                </td>
                <td>
                  <span className="badge">{run.kind}</span>
                </td>
                <td className="muted">{run.releaseName ?? '—'}</td>
                <td className="muted">{run.environmentName ?? '—'}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="coverage-bar" style={{ width: 90 }}>
                      {run.progress.passed > 0 ? (
                        <span
                          className="seg-automated"
                          style={{
                            width: `${(run.progress.passed / Math.max(run.progress.total, 1)) * 100}%`,
                          }}
                        />
                      ) : null}
                      {run.progress.failed > 0 ? (
                        <span
                          className="seg-never"
                          style={{
                            width: `${(run.progress.failed / Math.max(run.progress.total, 1)) * 100}%`,
                          }}
                        />
                      ) : null}
                    </div>
                    <span className="muted mono">
                      {executed}/{run.progress.total}
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`badge${run.status === 'open' ? '' : ' ok'}`}>{run.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateRunForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (id: string) => void;
}) {
  const plans = usePlans(projectId);
  const environments = useEnvironments(projectId);
  const releases = useReleases(projectId);
  const createRun = useCreateRun(projectId);
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [kind, setKind] = useState<'manual' | 'uat'>('manual');
  const [environmentId, setEnvironmentId] = useState('');
  const [releaseId, setReleaseId] = useState('');

  return (
    <div className="card" data-testid="create-run-form">
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <label>
          Name
          <input data-testid="run-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          From plan
          <select data-testid="run-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Select a plan…</option>
            {(plans.data?.plans ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.caseCount} cases)
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="manual">manual</option>
            <option value="uat">UAT</option>
          </select>
        </label>
        <label>
          Environment
          <select value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
            <option value="">None</option>
            {(environments.data?.environments ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Release
          <select
            data-testid="run-release"
            value={releaseId}
            onChange={(e) => setReleaseId(e.target.value)}
          >
            <option value="">None</option>
            {(releases.data?.releases ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {createRun.error ? <p className="error">Could not create the run.</p> : null}
      <button
        type="button"
        data-testid="create-run"
        style={{ marginTop: 10 }}
        disabled={!name || !planId || createRun.isPending}
        onClick={() =>
          createRun.mutate(
            {
              name,
              kind,
              planId,
              ...(environmentId ? { environmentId } : {}),
              ...(releaseId ? { releaseId } : {}),
            },
            { onSuccess: (created) => onCreated(created.id) },
          )
        }
      >
        Create run
      </button>
    </div>
  );
}

function PlanningPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const plans = usePlans(projectId);
  const environments = useEnvironments(projectId);
  const releases = useReleases(projectId);

  return (
    <div className="planning-grid">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Test plans</h3>
        <table data-testid="plans-table">
          <tbody>
            {(plans.data?.plans ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.caseCount} cases</td>
              </tr>
            ))}
            {plans.data?.plans.length === 0 ? (
              <tr>
                <td className="muted">No plans yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Environments</h3>
        <table data-testid="environments-table">
          <tbody>
            {(environments.data?.environments ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td className="muted">{e.runCount} runs</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Releases</h3>
        <table data-testid="releases-table">
          <tbody>
            {(releases.data?.releases ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>
                  <span className="badge">{r.status}</span>
                </td>
                <td className="muted">{r.runCount} runs</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage ? null : (
        <p className="muted">Read-only: creating plans requires the lead role.</p>
      )}
    </div>
  );
}
