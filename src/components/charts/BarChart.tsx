type BarItem = { label: string; value: number; color?: string };

type BarChartProps = {
  items: BarItem[];
  max?: number;
  /** Suffix appended to each value label. Default "%". Pass "" for raw counts. */
  valueSuffix?: string;
};

export function BarChart({ items, max, valueSuffix = "%" }: BarChartProps) {
  const maxVal = max ?? Math.max(...items.map((i) => i.value), 1);
  const barH = 14;
  const gap = 8;
  const labelW = 90;
  const valW = 32;
  const W = 280;
  const H = items.length * (barH + gap);
  const barMaxW = W - labelW - valW - 8;
  // Accessible summary — the per-bar values otherwise live only inside the SVG.
  const summary = items.map((i) => `${i.label} ${i.value}${valueSuffix}`).join(", ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`Bar chart. ${summary}`}
      style={{ display: "block" }}
    >
      {items.map((item, i) => {
        // A true zero renders an empty track; otherwise floor at 2px so small
        // (but non-zero) bars stay visible.
        const barW = item.value > 0 ? Math.max(2, (item.value / maxVal) * barMaxW) : 0;
        const y = i * (barH + gap);
        const color = item.color ?? "var(--green)";
        return (
          <g key={item.label}>
            <text x="0" y={y + barH - 2} fontSize="10" fill="rgba(141,154,160,0.9)" textAnchor="start">
              {item.label}
            </text>
            <rect x={labelW} y={y} width={barW} height={barH} fill={color} opacity="0.75" rx="2" />
            <text x={labelW + barW + 5} y={y + barH - 2} fontSize="10" fill="rgba(232,225,207,0.8)">
              {item.value}{valueSuffix}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
