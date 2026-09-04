import type { Suite } from '@tcms/shared';
import { useMemo, useState } from 'react';

/** Renders the suite tree; selecting a suite scopes the case list to its subtree. */
export function SuiteTree({
  suites,
  selectedId,
  onSelect,
}: {
  suites: Suite[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const byParent = useMemo(() => {
    const map = new Map<string | null, Suite[]>();
    for (const suite of suites) {
      const key = suite.parentId;
      map.set(key, [...(map.get(key) ?? []), suite]);
    }
    return map;
  }, [suites]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function render(parentId: string | null, depth: number): React.ReactNode {
    return (byParent.get(parentId) ?? []).map((suite) => {
      const children = byParent.get(suite.id) ?? [];
      const isCollapsed = collapsed.has(suite.id);
      return (
        <div key={suite.id}>
          <div
            className={`suite-row${selectedId === suite.id ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <button
              type="button"
              className="twisty"
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              onClick={() => toggle(suite.id)}
              style={{ visibility: children.length ? 'visible' : 'hidden' }}
            >
              {isCollapsed ? '+' : '-'}
            </button>
            <button
              type="button"
              className="suite-name"
              data-testid={`suite-${suite.id}`}
              onClick={() => onSelect(suite.id)}
            >
              {suite.name}
            </button>
            <span className="muted count">{suite.caseCount}</span>
          </div>
          {isCollapsed ? null : render(suite.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <nav className="suite-tree" aria-label="Suites">
      <div className={`suite-row${selectedId === null ? ' selected' : ''}`}>
        <span className="twisty" />
        <button
          type="button"
          className="suite-name"
          data-testid="suite-all"
          onClick={() => onSelect(null)}
        >
          All cases
        </button>
        <span className="muted count">{suites.reduce((n, s) => n + s.caseCount, 0)}</span>
      </div>
      {render(null, 0)}
    </nav>
  );
}
