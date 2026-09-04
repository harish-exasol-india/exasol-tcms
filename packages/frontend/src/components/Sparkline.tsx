/**
 * A small inline trend line. Deliberately not a charting library: the series is short and
 * the shape is the message, so an SVG polyline conveys it without a dependency.
 */
export function Sparkline({
  values,
  width = 200,
  height = 36,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}) {
  if (values.length < 2) {
    return (
      <span className="muted" style={{ fontSize: 12 }}>
        not enough data
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; draw it through the middle instead.
  const span = max - min || 1;
  const points = values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${values.length} points, from ${min} to ${max}`}
      className="sparkline"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
