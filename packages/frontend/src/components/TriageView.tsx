import { useState } from 'react';
import { useTriage, useUpdateTriage } from '../lib/execution.js';

const STATES = ['new', 'investigating', 'known_issue', 'flaky', 'resolved', 'regression'] as const;

/**
 * Failure triage (task 7.6).
 *
 * The value of this view is the separation between failures that need a decision and those
 * that already have one: a run with 40 known failures and 2 new ones needs attention on 2.
 */
export function TriageView({ projectId, canTriage }: { projectId: string; canTriage: boolean }) {
  const [filter, setFilter] = useState<string>('');
  const triage = useTriage(projectId, filter || undefined);
  const update = useUpdateTriage(projectId);

  if (triage.isPending)
    return (
      <p className="muted" style={{ padding: 16 }}>
        Loading triage…
      </p>
    );

  const counts = triage.data?.counts ?? {};
  const needsAttention = (counts['new'] ?? 0) + (counts['regression'] ?? 0);

  return (
    <div style={{ padding: 16 }} className="binding-report">
      <div className="stat-row">
        <div className="stat danger">
          <span className="stat-value" data-testid="triage-attention">
            {needsAttention}
          </span>
          <span className="stat-label">Need a decision</span>
        </div>
        {STATES.map((state) => (
          <div className="stat" key={state}>
            <span className="stat-value" data-testid={`triage-count-${state}`}>
              {counts[state] ?? 0}
            </span>
            <span className="stat-label">{state.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <p className="note">
        A failure matching a previously triaged signature inherits that decision automatically, so a
        known issue does not re-alert on every import. A failure recurring after being resolved is
        raised as a <strong>regression</strong> rather than silently inheriting.
      </p>

      <div className="toolbar">
        <span className="muted">Filter</span>
        <button
          type="button"
          data-testid="triage-filter-all"
          className={filter === '' ? '' : 'secondary'}
          onClick={() => setFilter('')}
        >
          All
        </button>
        {STATES.map((state) => (
          <button
            type="button"
            key={state}
            data-testid={`triage-filter-${state}`}
            className={filter === state ? '' : 'secondary'}
            onClick={() => setFilter(state)}
          >
            {state.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table data-testid="triage-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Failure</th>
              <th>Seen</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {(triage.data?.entries ?? []).map((entry) => (
              <tr key={entry.id} data-testid={`triage-row-${entry.id}`}>
                <td>
                  <span className="mono">{entry.caseRef}</span>{' '}
                  <span className="muted">{entry.caseTitle}</span>
                </td>
                <td className="muted" style={{ maxWidth: 380 }}>
                  <div className="truncate">{entry.lastFailureMessage ?? '—'}</div>
                </td>
                <td className="mono">{entry.occurrences}×</td>
                <td>
                  {canTriage ? (
                    <select
                      data-testid={`triage-state-${entry.id}`}
                      value={entry.state}
                      onChange={(e) => update.mutate({ triageId: entry.id, state: e.target.value })}
                    >
                      {STATES.map((state) => (
                        <option key={state} value={state}>
                          {state.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge">{entry.state}</span>
                  )}
                </td>
              </tr>
            ))}
            {triage.data?.entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No failures to triage.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
