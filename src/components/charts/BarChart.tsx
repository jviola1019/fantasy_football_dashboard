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
      <defs>
        <filter id="barGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {items.map((item, i) => {
        const barW = Math.max(2, (item.value / maxVal) * barMaxW);
        const y = i * (barH + gap);
        const color = item.color ?? "#77d7b0";
        return (
          <g key={item.label}>
            <text x="0" y={y + barH - 2} fontSize="10" fill="rgba(122,136,148,0.9)" textAnchor="start">
              {item.label}
            </text>
            {/* Bar body */}
            <rect x={labelW} y={y} width={barW} height={barH} fill={color} opacity="0.55" rx="2" />
            {/* Glowing end cap */}
            <rect x={labelW + barW - 3} y={y} width={3} height={barH} fill={color} opacity="0.95" rx="1" filter="url(#barGlow)" />
            <text x={labelW + barW + 7} y={y + barH - 2} fontSize="10" fill="rgba(232,225,207,0.82)">
              {item.value}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
