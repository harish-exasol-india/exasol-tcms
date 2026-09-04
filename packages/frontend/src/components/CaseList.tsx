import { useVirtualizer } from '@tanstack/react-virtual';
import type { CaseListItem } from '@tcms/shared';
import { useEffect, useRef } from 'react';

const ROW_HEIGHT = 38;

/**
 * Virtualised case list (task 4.10).
 *
 * Only the visible window is in the DOM, so a 25,000-case project scrolls at the same cost
 * as a 25-case one. Reaching the end triggers the next page rather than fetching everything
 * up front.
 */
export function CaseList({
  cases,
  total,
  selectedId,
  onSelect,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: {
  cases: CaseListItem[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (hasMore && !isLoadingMore && lastIndex >= cases.length - 20 && cases.length > 0) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, lastIndex, cases.length, onLoadMore]);

  return (
    <div className="case-list">
      <div className="case-list-header">
        <span data-testid="case-count">
          {cases.length.toLocaleString()} of {total.toLocaleString()} case
          {total === 1 ? '' : 's'}
        </span>
        {isLoadingMore ? <span className="muted">loading more…</span> : null}
      </div>

      <div className="case-list-columns">
        <span>Ref</span>
        <span>Title</span>
        <span>Suite</span>
        <span>Priority</span>
        <span>Automation</span>
        <span>Tags</span>
      </div>

      <div className="case-list-scroll" ref={scrollRef} data-testid="case-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((virtualRow) => {
            const item = cases[virtualRow.index];
            if (!item) return null;
            return (
              <button
                type="button"
                key={item.id}
                data-testid={`case-row-${item.ref}`}
                className={`case-row${item.id === selectedId ? ' selected' : ''}`}
                onClick={() => onSelect(item.id)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className="mono">{item.ref}</span>
                <span className="title">{item.title}</span>
                <span className="muted">{item.suitePath.at(-1)}</span>
                <span className={`prio prio-${item.priority}`}>{item.priority}</span>
                <span>
                  {item.isAutomated ? (
                    <span className="badge ok">automated</span>
                  ) : (
                    <span className="badge">manual</span>
                  )}
                </span>
                <span className="tags">
                  {item.tags.slice(0, 3).map((t) => (
                    <span key={t} className="badge tag">
                      {t}
                    </span>
                  ))}
                  {item.tags.length > 3 ? (
                    <span className="muted">+{item.tags.length - 3}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
