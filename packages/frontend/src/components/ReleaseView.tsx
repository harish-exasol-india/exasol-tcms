import { useState } from 'react';
import { useAddSignOff, useCompleteSignOff, useReadiness, useReleases } from '../lib/execution.js';
import { CoverageBar, coveragePercent } from './CoverageBar.js';

/**
 * Release readiness (task 10.7).
 *
 * AC 4 asks for everything a go/no-go discussion needs in one place. The gate reflects
 * approvals rather than computed evidence (design Decision 16), so the evidence is placed
 * immediately beside it: an approver signs off in full view of the pass rate, the blocking
 * failures and the coverage gap.
 */
export function ReleaseView({
  projectId,
  canSignOff,
  canManage,
}: {
  projectId: string;
  canSignOff: boolean;
  canManage: boolean;
}) {
  const releases = useReleases(projectId);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const active = releaseId ?? releases.data?.releases[0]?.id ?? null;
  const readiness = useReadiness(projectId, active);
  const completeSignOff = useCompleteSignOff(projectId, active);
  const addSignOff = useAddSignOff(projectId, active);
  const [newItem, setNewItem] = useState('');

  if (releases.isPending)
    return (
      <p className="muted" style={{ padding: 16 }}>
        Loading releases…
      </p>
    );
  if (!releases.data?.releases.length) {
    return (
      <p className="muted" style={{ padding: 16 }}>
        No releases defined yet.
      </p>
    );
  }

  const data = readiness.data;

  return (
    <div style={{ padding: 16 }} className="binding-report">
      <div className="toolbar">
        <span className="muted">Release</span>
        <select
          data-testid="release-picker"
          value={active ?? ''}
          onChange={(e) => setReleaseId(e.target.value)}
        >
          {releases.data.releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.status})
            </option>
          ))}
        </select>
      </div>

      {readiness.isPending ? <p className="muted">Loading readiness…</p> : null}

      {data ? (
        <>
          <div
            className={`gate-banner ${data.gate.signedOff ? 'ok' : 'pending'}`}
            data-testid="gate-status"
          >
            <strong>{data.gate.signedOff ? 'Signed off' : 'Not signed off'}</strong>
            {data.gate.outstanding.length > 0 ? (
              <span> — outstanding: {data.gate.outstanding.join(', ')}</span>
            ) : null}
            {data.gate.items.length === 0 ? <span> — no sign-off items defined</span> : null}
          </div>

          <div className="stat-row">
            {data.execution ? (
              <>
                <div className="stat">
                  <span className="stat-value" data-testid="release-pass-rate">
                    {data.execution.passRate}%
                  </span>
                  <span className="stat-label">Pass rate</span>
                </div>
                <div className="stat">
                  <span className="stat-value" data-testid="release-executed">
                    {(data.execution.total - data.execution.untested).toLocaleString()}/
                    {data.execution.total.toLocaleString()}
                  </span>
                  <span className="stat-label">Executed</span>
                </div>
              </>
            ) : (
              <div className="stat warn" data-testid="release-no-data">
                <span className="stat-value">—</span>
                <span className="stat-label">No runs yet</span>
              </div>
            )}
            <div className={`stat${data.blocking.count > 0 ? ' danger' : ' ok'}`}>
              <span className="stat-value" data-testid="release-blocking">
                {data.blocking.count}
              </span>
              <span className="stat-label">Blocking failures</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="release-known">
                {data.blocking.known}
              </span>
              <span className="stat-label">Known issues</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="release-coverage">
                {coveragePercent(data.coverage)}%
              </span>
              <span className="stat-label">Automated coverage</span>
            </div>
            <div className="stat">
              <span className="stat-value" data-testid="release-uat">
                {data.uat.closed}/{data.uat.total}
              </span>
              <span className="stat-label">UAT runs closed</span>
            </div>
          </div>

          {data.execution === null ? (
            <p className="note">
              No runs have been attributed to this release, so there is no execution evidence. This
              is <strong>absence of data</strong>, not a passing result.
            </p>
          ) : null}

          <CoverageBar summary={data.coverage} />

          <div className="release-columns">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Blocking failures</h3>
              {data.blocking.items.length === 0 ? (
                <p className="muted">None. {data.blocking.known} known issue(s) excluded.</p>
              ) : (
                <table data-testid="blocking-table">
                  <tbody>
                    {data.blocking.items.slice(0, 25).map((item) => (
                      <tr key={`${item.caseRef}-${item.state}-${item.message ?? ''}`}>
                        <td className="mono">{item.caseRef}</td>
                        <td className="truncate">{item.caseTitle}</td>
                        <td>
                          <span className="badge warn">{item.state}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Linked defects</h3>
              {data.defects.length === 0 ? (
                <p className="muted">None linked.</p>
              ) : (
                <table data-testid="defects-table">
                  <tbody>
                    {data.defects.slice(0, 25).map((d) => (
                      <tr key={`${d.issueKey}-${d.caseRef}`}>
                        <td>
                          <a href={d.url} target="_blank" rel="noreferrer" className="mono">
                            {d.issueKey}
                          </a>
                        </td>
                        <td className="mono muted">{d.caseRef}</td>
                        <td className="muted">{d.ageDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Age is measured from when the link was recorded here. Defect status and severity
                live in Jira and are not read back.
              </p>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Sign-off</h3>
            <table data-testid="signoff-table">
              <tbody>
                {data.gate.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="muted">{item.approverName ?? 'anyone'}</td>
                    <td>
                      {item.completedAt ? (
                        <span className="badge ok" data-testid={`signoff-done-${item.id}`}>
                          {item.completedByName} · {new Date(item.completedAt).toLocaleDateString()}
                        </span>
                      ) : canSignOff ? (
                        <button
                          type="button"
                          data-testid={`signoff-complete-${item.id}`}
                          onClick={() => completeSignOff.mutate(item.id)}
                          disabled={completeSignOff.isPending}
                        >
                          Sign off
                        </button>
                      ) : (
                        <span className="badge">pending</span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.gate.items.length === 0 ? (
                  <tr>
                    <td className="muted">No sign-off items yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {canManage ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                  data-testid="signoff-name"
                  placeholder="e.g. QA lead"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                />
                <button
                  type="button"
                  data-testid="signoff-add"
                  disabled={!newItem}
                  onClick={() => {
                    addSignOff.mutate(newItem);
                    setNewItem('');
                  }}
                >
                  Add item
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
