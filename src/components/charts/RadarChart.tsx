type RadarAxis = { label: string; value: number };

type RadarChartProps = {
  axes: RadarAxis[];
  max?: number;
  size?: number;
};

export function RadarChart({ axes, max = 100, size = 160 }: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;
  const n = axes.length;
  const levels = [0.25, 0.5, 0.75, 1.0];

  const point = (angle: number, radius: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const axisAngle = (i: number) => (i / n) * 360;

  const gridPolygon = (level: number) =>
    axes
      .map((_, i) => {
        const p = point(axisAngle(i), r * level);
        return `${p.x},${p.y}`;
      })
      .join(" ");

  const dataPolygon = axes
    .map((axis, i) => {
      const p = point(axisAngle(i), r * Math.min(1, Math.max(0, axis.value / max)));
      return `${p.x},${p.y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      {levels.map((level) => (
        <polygon
          key={level}
          points={gridPolygon(level)}
          fill="none"
          stroke="rgba(214,226,226,0.1)"
          strokeWidth="1"
        />
      ))}
      {axes.map((_, i) => {
        const p = point(axisAngle(i), r);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="rgba(214,226,226,0.12)"
            strokeWidth="1"
          />
        );
      })}
      <polygon points={dataPolygon} fill="rgba(77,217,192,0.18)" stroke="#4dd9c0" strokeWidth="1.5" />
      {axes.map((axis, i) => {
        const p = point(axisAngle(i), r + 14);
        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="9"
            fill="rgba(141,154,160,0.85)"
          >
            {axis.label}
          </text>
        );
      })}
    </svg>
  );
}
