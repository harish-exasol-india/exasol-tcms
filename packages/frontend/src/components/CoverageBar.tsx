import type { CoverageSummary } from '@tcms/shared';

/**
 * The three buckets are mutually exclusive and sum to the total, so the bar is drawn from
 * shares of that total rather than from independent percentages — a reader should never be
 * shown segments that do not add up.
 */
export function CoverageBar({ summary }: { summary: CoverageSummary }) {
  const total = Math.max(summary.total, 1);
  const segments = [
    { key: 'automated', value: summary.automated, className: 'seg-automated' },
    { key: 'manual', value: summary.manual, className: 'seg-manual' },
    { key: 'never', value: summary.neverExecuted, className: 'seg-never' },
  ];

  return (
    <div className="coverage-bar" title={`${summary.automated} of ${summary.total} automated`}>
      {segments.map((seg) =>
        seg.value > 0 ? (
          <span
            key={seg.key}
            className={seg.className}
            style={{ width: `${(seg.value / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

export function coveragePercent(summary: CoverageSummary): number {
  // An empty selection is 0% covered, not 100%: a scope with no cases is a gap, not
  // an achievement.
  if (summary.total === 0) return 0;
  return Math.round((summary.automated / summary.total) * 100);
}
