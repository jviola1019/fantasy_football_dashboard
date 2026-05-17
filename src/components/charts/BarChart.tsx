type BarItem = { label: string; value: number; color?: string };

type BarChartProps = {
  items: BarItem[];
  max?: number;
};

export function BarChart({ items, max }: BarChartProps) {
  const maxVal = max ?? Math.max(...items.map((i) => i.value), 1);
  const barH = 14;
  const gap = 8;
  const labelW = 90;
  const valW = 32;
  const W = 280;
  const H = items.length * (barH + gap);
  const barMaxW = W - labelW - valW - 8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true" style={{ display: "block" }}>
      {items.map((item, i) => {
        const barW = Math.max(2, (item.value / maxVal) * barMaxW);
        const y = i * (barH + gap);
        const color = item.color ?? "var(--green)";
        return (
          <g key={item.label}>
            <text x="0" y={y + barH - 2} fontSize="10" fill="rgba(141,154,160,0.9)" textAnchor="start">
              {item.label}
            </text>
            <rect x={labelW} y={y} width={barW} height={barH} fill={color} opacity="0.75" rx="2" />
            <text x={labelW + barW + 5} y={y + barH - 2} fontSize="10" fill="rgba(232,225,207,0.8)">
              {item.value}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
