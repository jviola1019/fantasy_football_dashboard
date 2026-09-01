import { THEME, withAlpha } from "@/lib/theme";

type RadarAxis = {
  label: string;
  value: number;
  /**
   * When true, this axis is rendered with a dashed grid line and the label
   * is grayed — communicating that the underlying metric has no real data
   * source yet. The polygon still hits the axis at value 0 so the user
   * sees the absence rather than a misleading mid-band reading.
   */
  unavailable?: boolean;
};

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
      // Unavailable axes contribute 0 to the polygon so the rendered shape
      // honestly reflects what we actually know about the player.
      const value = axis.unavailable ? 0 : axis.value;
      const p = point(axisAngle(i), r * Math.min(1, Math.max(0, value / max)));
      return `${p.x},${p.y}`;
    })
    .join(" ");

  // Accessible summary — the per-axis values otherwise live only inside the SVG.
  const summary = axes
    .map((a) => `${a.label} ${a.unavailable ? "no data" : a.value}`)
    .join(", ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Metric profile. ${summary}`}
    >
      {levels.map((level) => (
        <polygon
          key={level}
          points={gridPolygon(level)}
          fill="none"
          stroke="rgba(214,226,226,0.1)"
          strokeWidth="1"
        />
      ))}
      {axes.map((axis, i) => {
        const p = point(axisAngle(i), r);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke={axis.unavailable ? "rgba(141,154,160,0.18)" : "rgba(214,226,226,0.12)"}
            strokeWidth="1"
            strokeDasharray={axis.unavailable ? "3 3" : undefined}
          />
        );
      })}
      {/*
        THEME.teal, not #4dd9c0. That hex was in neither THEME nor globals.css --
        an off-palette mint left over from a pre-repaint version, and the only
        colour in the app outside the design system. theme.test.ts guards the
        tokens against the stylesheet but cannot see a literal typed into a
        component, which is why it survived. A deliberate small visual change:
        the data polygon moves from #4dd9c0 to the system teal #2fb6c4.
      */}
      <polygon
        points={dataPolygon}
        fill={withAlpha(THEME.teal, 0.18)}
        stroke={THEME.teal}
        strokeWidth="1.5"
      />
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
            fill={axis.unavailable ? "rgba(141,154,160,0.45)" : "rgba(141,154,160,0.85)"}
          >
            {axis.label}
            {axis.unavailable ? " *" : ""}
          </text>
        );
      })}
    </svg>
  );
}
