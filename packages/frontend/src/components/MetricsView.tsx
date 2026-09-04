import { useState } from 'react';
import { useMetrics } from '../lib/execution.js';
import { CoverageBar, coveragePercent } from './CoverageBar.js';
import { Sparkline } from './Sparkline.js';

const WINDOWS = [7, 30, 90, 365];

/** Quality metrics and trends (task 11.5). */
export function MetricsView({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(90);
  const metrics = useMetrics(projectId, days);

  if (metrics.isPending)
    return (
      <p className="muted" style={{ padding: 16 }}>
        Loading metrics…
      </p>
    );
  if (!metrics.data)
    return (
      <p className="error" style={{ padding: 16 }}>
        Could not load metrics.
      </p>
    );

  const { totals, trend, flaky, coverage, window, defectAgeBands, trendTruncated } = metrics.data;
  const fmtMs = (ms: number | null) =>
    ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  return (
    <div style={{ padding: 16 }} className="binding-report">
      <div className="toolbar">
        <span className="muted">Window</span>
        {WINDOWS.map((d) => (
          <button
            type="button"
            key={d}
            data-testid={`metrics-window-${d}`}
            className={days === d ? '' : 'secondary'}
            onClick={() => setDays(d)}
          >
            {d}d
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="muted" data-testid="metrics-window-label">
          {window.days} days shown · retention {window.retentionMonths} months
        </span>
      </div>

      {trendTruncated ? (
        <p className="note" data-testid="metrics-truncated">
          The requested window extends beyond the {window.retentionMonths}-month retention period.
          Earlier execution history has been deleted, so the series starts where retained data
          begins — this is the edge of retention, not a quiet period.
        </p>
      ) : null}

      <div className="stat-row">
        <div className="stat ok">
          <span className="stat-value" data-testid="metric-pass-rate">
            {totals.passRate}%
          </span>
          <span className="stat-label">Pass rate</span>
        </div>
        <div className="stat danger">
          <span className="stat-value" data-testid="metric-failure-rate">
            {totals.failureRate}%
          </span>
          <span className="stat-label">Failure rate</span>
        </div>
        <div className="stat">
          <span className="stat-value" data-testid="metric-executions">
            {totals.executions.toLocaleString()}
          </span>
          <span className="stat-label">Executions</span>
        </div>
        <div className="stat">
          <span className="stat-value">{fmtMs(totals.runtimeMsP50)}</span>
          <span className="stat-label">Runtime p50</span>
        </div>
        <div className="stat">
          <span className="stat-value">{fmtMs(totals.runtimeMsP95)}</span>
          <span className="stat-label">Runtime p95</span>
        </div>
        <div className="stat">
          <span className="stat-value" data-testid="metric-coverage">
            {coveragePercent(coverage)}%
          </span>
          <span className="stat-label">Automated coverage</span>
        </div>
      </div>

      <CoverageBar summary={coverage} />

      <div className="release-columns">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Trends</h3>
          <div className="trend-row">
            <span className="muted">Pass rate</span>
            <Sparkline values={trend.map((t) => t.passRate)} label="pass rate" />
          </div>
          <div className="trend-row">
            <span className="muted">Executions</span>
            <Sparkline values={trend.map((t) => t.executions)} label="executions" />
          </div>
          <div className="trend-row">
            <span className="muted">Runtime p50</span>
            <Sparkline values={trend.map((t) => t.runtimeMsP50 ?? 0)} label="runtime p50" />
          </div>
          <p className="muted" style={{ fontSize: 12 }} data-testid="trend-points">
            {trend.length} day(s) with data
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Open defect links by age</h3>
          <table data-testid="defect-age-table">
            <tbody>
              {defectAgeBands.map((band) => (
                <tr key={band.band}>
                  <td>{band.band}</td>
                  <td className="mono">{band.count}</td>
                </tr>
              ))}
              {defectAgeBands.length === 0 ? (
                <tr>
                  <td className="muted">No defect links.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Flaky candidates</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Tests that produced differing outcomes across runs of the same commit. Retries within a
          single run are not visible: JUnit XML does not carry them.
        </p>
        <table data-testid="flaky-table">
          <tbody>
            {flaky.slice(0, 30).map((f) => (
              <tr key={`${f.caseRef}-${f.commitSha}`}>
                <td className="mono">{f.caseRef}</td>
                <td className="truncate">{f.caseTitle}</td>
                <td className="mono muted">{f.commitSha.slice(0, 8)}</td>
                <td>
                  {f.outcomes.map((o) => (
                    <span key={o} className={`badge outcome-${o}`}>
                      {o}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {flaky.length === 0 ? (
              <tr>
                <td className="muted">No flaky candidates in this window.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
