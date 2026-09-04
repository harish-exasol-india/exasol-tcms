import { useState } from 'react';
import { type CoverageFilters, useCoverage, useUncoveredCases } from '../lib/coverage.js';
import { useSuites, useTags } from '../lib/repository.js';
import { CoverageBar, coveragePercent } from './CoverageBar.js';
import { SuiteTree } from './SuiteTree.js';

type GroupBy = 'none' | 'tag' | 'suite';

/**
 * Coverage reporting (AC 3, task 8.4).
 *
 * Reports automation coverage only — which managed cases have an automation binding. There
 * is no Requirement entity (design Decision 3), so this view deliberately cannot answer
 * "which features have no cases at all", and says so rather than implying otherwise.
 */
export function CoverageView({ projectId }: { projectId: string }) {
  const [suiteId, setSuiteId] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('tag');
  const [drilling, setDrilling] = useState(false);

  const filters: CoverageFilters = {
    ...(suiteId ? { suiteId } : {}),
    ...(activeTags.length ? { tags: activeTags } : {}),
    groupBy,
  };

  const suites = useSuites(projectId);
  const tags = useTags(projectId);
  const coverage = useCoverage(projectId, filters);
  const uncovered = useUncoveredCases(projectId, filters, drilling);

  const toggleTag = (name: string) =>
    setActiveTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );

  return (
    <div className="repository">
      <div className="repository-sidebar">
        {suites.data ? (
          <SuiteTree suites={suites.data.suites} selectedId={suiteId} onSelect={setSuiteId} />
        ) : (
          <p className="muted">Loading suites…</p>
        )}
        <div className="filter-block">
          <h3>Tags</h3>
          <div className="tags">
            {(tags.data?.tags ?? []).slice(0, 24).map((tag) => (
              <button
                type="button"
                key={tag.name}
                data-testid={`coverage-tag-${tag.name}`}
                className={`badge tag${activeTags.includes(tag.name) ? ' active' : ''}`}
                onClick={() => toggleTag(tag.name)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="repository-main" style={{ overflowY: 'auto', padding: 16 }}>
        {coverage.isPending ? <p className="muted">Calculating coverage…</p> : null}
        {coverage.isError ? <p className="error">Could not calculate coverage.</p> : null}

        {coverage.data ? (
          <div className="binding-report">
            <div className="stat-row">
              <div className="stat">
                <span className="stat-value" data-testid="coverage-percent">
                  {coveragePercent(coverage.data.summary)}%
                </span>
                <span className="stat-label">Automated</span>
              </div>
              <div className="stat">
                <span className="stat-value" data-testid="coverage-total">
                  {coverage.data.summary.total.toLocaleString()}
                </span>
                <span className="stat-label">Managed cases</span>
              </div>
              <div className="stat ok">
                <span className="stat-value" data-testid="coverage-automated">
                  {coverage.data.summary.automated.toLocaleString()}
                </span>
                <span className="stat-label">Automated</span>
              </div>
              <div className="stat warn">
                <span className="stat-value" data-testid="coverage-manual">
                  {coverage.data.summary.manual.toLocaleString()}
                </span>
                <span className="stat-label">Manual only</span>
              </div>
              <div className="stat danger">
                <span className="stat-value" data-testid="coverage-never">
                  {coverage.data.summary.neverExecuted.toLocaleString()}
                </span>
                <span className="stat-label">Never executed</span>
              </div>
            </div>

            <CoverageBar summary={coverage.data.summary} />
            <div className="legend">
              <span>
                <i className="seg-automated" /> automated
              </span>
              <span>
                <i className="seg-manual" /> manual only
              </span>
              <span>
                <i className="seg-never" /> never executed
              </span>
            </div>

            <p className="note">
              Coverage here means <strong>automation coverage</strong>: which managed cases have an
              automated test bound to them. It cannot show features that have no test case at all —
              that would need a requirements model, which is out of scope.
            </p>

            <div className="toolbar">
              <span className="muted">Group by</span>
              {(['tag', 'suite', 'none'] as const).map((g) => (
                <button
                  type="button"
                  key={g}
                  data-testid={`coverage-group-${g}`}
                  className={groupBy === g ? '' : 'secondary'}
                  onClick={() => setGroupBy(g)}
                >
                  {g === 'none' ? 'Nothing' : g}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="secondary"
                data-testid="coverage-drill"
                onClick={() => setDrilling((d) => !d)}
              >
                {drilling ? 'Hide' : 'Show'} the{' '}
                {(
                  coverage.data.summary.manual + coverage.data.summary.neverExecuted
                ).toLocaleString()}{' '}
                cases without automation
              </button>
            </div>

            {groupBy !== 'none' && coverage.data.groups.length > 0 ? (
              <div className="card" style={{ padding: 0 }}>
                <table data-testid="coverage-groups">
                  <thead>
                    <tr>
                      <th>{groupBy === 'tag' ? 'Tag' : 'Suite'}</th>
                      <th style={{ width: '30%' }}>Coverage</th>
                      <th>Automated</th>
                      <th>Manual</th>
                      <th>Never run</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.data.groups.map((group) => (
                      <tr key={group.key} data-testid={`coverage-group-row-${group.key}`}>
                        <td>{group.label}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CoverageBar summary={group} />
                            <span className="muted mono">{coveragePercent(group)}%</span>
                          </div>
                        </td>
                        <td>{group.automated.toLocaleString()}</td>
                        <td>{group.manual.toLocaleString()}</td>
                        <td>{group.neverExecuted.toLocaleString()}</td>
                        <td>{group.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {drilling ? (
              <>
                <h3>Cases with no automation</h3>
                {uncovered.isPending ? <p className="muted">Loading…</p> : null}
                {uncovered.data ? (
                  <div className="card" style={{ padding: 0 }}>
                    <table data-testid="uncovered-table">
                      <thead>
                        <tr>
                          <th>Ref</th>
                          <th>Title</th>
                          <th>Suite</th>
                          <th>Priority</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uncovered.data.cases.slice(0, 200).map((c) => (
                          <tr key={c.id}>
                            <td className="mono">{c.ref}</td>
                            <td>{c.title}</td>
                            <td className="muted">{c.suiteName}</td>
                            <td>{c.priority}</td>
                            <td>
                              <span className={`badge${c.everExecuted ? '' : ' warn'}`}>
                                {c.everExecuted ? 'manual only' : 'never executed'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {uncovered.data.total > 200 ? (
                          <tr data-testid="uncovered-truncation">
                            <td colSpan={5} className="muted">
                              {(uncovered.data.total - 200).toLocaleString()} further cases not
                              shown. Narrow by suite or tag to see them.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
