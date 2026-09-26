export function ProgressRing({ pct, size = 34, stroke = 3, showLabel = true }: { pct: number; size?: number; stroke?: number; showLabel?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ring-bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring-fg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          style={{ strokeDasharray: c, strokeDashoffset: offset }}
        />
      </svg>
      {showLabel && <div className="ring-pct">{pct}</div>}
    </div>
  );
}
