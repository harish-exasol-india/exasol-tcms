import { useState } from 'react';
import { type BindingFilter, useBindingReport } from '../lib/automation.js';

/**
 * Automation binding health (task 6.10).
 *
 * With no Requirement entity, this binding is the entire coverage signal — nothing
 * cross-checks it. So the point of this view is not to list bindings but to make their
 * decay visible: which are name-based (and therefore break silently on a rename), which
 * have not been seen recently, and which incoming tests match nothing at all.
 */
export function BindingReport({ projectId }: { projectId: string }) {
  const [filter, setFilter] = useState<BindingFilter>('all');
  const report = useBindingReport(projectId, filter);

  if (report.isPending) return <p className="muted">Loading binding report…</p>;
  if (report.isError) return <p className="error">Could not load the binding report.</p>;

  const { bindings, summary, unboundTests } = report.data;
  // The server returns a bounded page ordered so that stale and fragile bindings come
  // first. The total for the active filter comes from the summary, so truncation can be
  // stated honestly rather than the view implying it holds everything.
  const shown = bindings;
  const matchingTotal =
    filter === 'fragile' ? summary.byName : filter === 'stale' ? summary.stale : summary.total;
  const truncated = Math.max(matchingTotal - shown.length, 0);

  return (
    <div className="binding-report">
      <div className="stat-row">
        <Stat label="Bindings" value={summary.total} />
        <Stat label="By case id" value={summary.byIdentifier} tone="ok" />
        <Stat
          label="By name (fragile)"
          value={summary.byName}
          tone={summary.byName > 0 ? 'warn' : undefined}
        />
        <Stat
          label={`Stale (>${summary.staleThresholdDays}d)`}
          value={summary.stale}
          tone={summary.stale > 0 ? 'danger' : undefined}
        />
        <Stat
          label="Unmatched tests"
          value={unboundTests.length}
          tone={unboundTests.length > 0 ? 'warn' : undefined}
        />
      </div>

      {summary.byName > 0 ? (
        <p className="note">
          {summary.byName} binding{summary.byName === 1 ? '' : 's'} rely on the test name. These
          break silently when a test is renamed or moved. Declaring a case id in the test promotes
          the binding and makes it rename-proof.
        </p>
      ) : null}

      <div className="toolbar">
        {(['all', 'fragile', 'stale'] as const).map((f) => {
          const count =
            f === 'all' ? summary.total : f === 'fragile' ? summary.byName : summary.stale;
          return (
            <button
              type="button"
              key={f}
              data-testid={`binding-filter-${f}`}
              className={filter === f ? '' : 'secondary'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'fragile' ? 'Name-based' : 'Stale'}{' '}
              <span className="muted">{count.toLocaleString()}</span>
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <span className="muted" data-testid="binding-shown-count">
          showing {shown.length.toLocaleString()} of {matchingTotal.toLocaleString()}
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table data-testid="bindings-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Automated test</th>
              <th>Binding</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} data-testid={`binding-${b.id}`}>
                <td>
                  <span className="mono">{b.caseRef}</span>{' '}
                  <span className="muted">{b.caseTitle}</span>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {b.fqName}
                </td>
                <td>
                  <span className={`badge${b.method === 'identifier' ? ' ok' : ' warn'}`}>
                    {b.method === 'identifier' ? 'case id' : 'name match'}
                  </span>
                </td>
                <td>
                  {b.lastSeenAt ? (
                    <span className={b.isStale ? 'error' : undefined}>
                      {new Date(b.lastSeenAt).toLocaleDateString()}
                      {b.isStale ? ' (stale)' : ''}
                    </span>
                  ) : (
                    <span className="error">never</span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing matches this filter.
                </td>
              </tr>
            ) : null}
            {truncated > 0 ? (
              <tr data-testid="binding-truncation">
                <td colSpan={4} className="muted">
                  {truncated.toLocaleString()} further binding{truncated === 1 ? '' : 's'} not
                  shown. Filter to Name-based or Stale to see the ones that need attention.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {unboundTests.length > 0 ? (
        <>
          <h3>Tests matching no managed case</h3>
          <p className="note">
            These ran in CI but bind to nothing, so they contribute to no coverage figure. No case
            is created for them automatically — the repository holds only cases someone owns.
          </p>
          <div className="card" style={{ padding: 0 }}>
            <table data-testid="unbound-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Outcome</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {unboundTests.slice(0, 100).map((t) => (
                  <tr key={`${t.fqName}-${t.seenAt}`}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {t.fqName}
                    </td>
                    <td>{t.outcome}</td>
                    <td className="muted">{new Date(t.seenAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

type Tone = 'ok' | 'warn' | 'danger';

function Stat({ label, value, tone }: { label: string; value: number; tone?: Tone | undefined }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <span className="stat-value">{value.toLocaleString()}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
