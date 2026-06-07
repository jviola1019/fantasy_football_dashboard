type Segment = { label: string; value: number; color: string };

type DonutChartProps = {
  segments: Segment[];
  centerLabel: string;
  centerValue: string;
};

export function DonutChart({ segments, centerLabel, centerValue }: DonutChartProps) {
  const r = 44;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;

  const fractions = segments.map((seg) => seg.value / total);
  const cumulativeRotations = fractions.map((_, i) =>
    -90 + fractions.slice(0, i).reduce((s, f) => s + f, 0) * 360
  );
  // Accessible summary — the segment values otherwise live only inside the SVG.
  const summary = segments.map((seg) => `${seg.label} ${seg.value}`).join(", ");

  return (
    <svg
      viewBox="0 0 140 140"
      width="140"
      height="140"
      role="img"
      aria-label={`${centerLabel}: ${centerValue}. ${summary}`}
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="14" />
      {segments.map((seg, i) => {
        const dash = fractions[i]! * circumference;
        const rotation = cumulativeRotations[i]!;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="14"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(${rotation} ${cx} ${cy})`}
            opacity="0.88"
          />
        );
      })}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize="16" fill="var(--cream)" fontWeight="600">
        {centerValue}
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="9" fill="var(--muted)">
        {centerLabel}
      </text>
    </svg>
  );
}
