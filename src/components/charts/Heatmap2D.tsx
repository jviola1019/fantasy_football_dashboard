"use client";

// 2-D heatmap using SVG <rect> cells. Replaces the WebGL volatility surface
// that was non-readable at 390px viewport. Each cell carries an aria-label
// and <title> tooltip; screen readers can traverse individual cells.

// Sprint 3 D5 palette: slate-blue (low) → warm-amber (mid) → coral (high).
// Three-band scale matches the new --blue / --accent-warm / --red system.
// Opacity ramps within each band so low-value cells are never invisible.
const DEFAULT_COLOR = (v: number): string => {
  if (v < 0.33) {
    const t = v / 0.33;
    return `rgba(74, 141, 183, ${0.22 + t * 0.52})`;       // slate-blue ramp
  }
  if (v < 0.66) {
    const t = (v - 0.33) / 0.33;
    return `rgba(215, 168, 87, ${0.38 + t * 0.44})`;        // warm-amber ramp
  }
  const t = (v - 0.66) / 0.34;
  return `rgba(217, 134, 111, ${0.52 + t * 0.42})`;         // coral ramp
};

interface Props {
  /** 2-D grid of values in [0, 1]. Outer array = rows (yLabels), inner = columns (xLabels). */
  data: number[][];
  xLabels: string[];
  yLabels: string[];
  /** Optional caption rendered below the chart. */
  caption?: string;
  /** Optional color scale function. Default is a cool-warm gradient. */
  colorScale?: (normalised: number) => string;
}

const CELL_W = 48;
const CELL_H = 30;
const PAD_LEFT = 72;
const PAD_TOP = 8;
const PAD_BOTTOM = 32;
const PAD_RIGHT = 8;

export function Heatmap2D({ data, xLabels, yLabels, caption, colorScale = DEFAULT_COLOR }: Props) {
  const rows = data.length;
  const cols = xLabels.length;
  const svgW = PAD_LEFT + cols * CELL_W + PAD_RIGHT;
  const svgH = PAD_TOP + rows * CELL_H + PAD_BOTTOM;

  return (
    <div style={{ width: "100%", maxWidth: svgW }}>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Heatmap showing probability distribution across risk and scenario dimensions"
        style={{ overflow: "visible", display: "block" }}
      >
        {/* Y-axis labels */}
        {yLabels.map((label, r) => (
          <text
            key={r}
            x={PAD_LEFT - 6}
            y={PAD_TOP + r * CELL_H + CELL_H / 2 + 4}
            textAnchor="end"
            fontSize={9}
            fill="var(--muted)"
          >
            {label}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((label, c) => (
          <text
            key={c}
            x={PAD_LEFT + c * CELL_W + CELL_W / 2}
            y={PAD_TOP + rows * CELL_H + 14}
            textAnchor="middle"
            fontSize={9}
            fill="var(--muted)"
          >
            {label}
          </text>
        ))}

        {/* Cells */}
        {data.map((row, r) =>
          row.map((val, c) => {
            const pct = Math.round(val * 100);
            const x = PAD_LEFT + c * CELL_W;
            const y = PAD_TOP + r * CELL_H;
            const label = `${yLabels[r] ?? ""} / ${xLabels[c] ?? ""}: ${pct}%`;
            return (
              <g key={`${r}-${c}`} aria-label={label}>
                <rect
                  x={x}
                  y={y}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={3}
                  fill={colorScale(val)}
                >
                  <title>{label}</title>
                </rect>
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2 + 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="rgba(255,255,255,0.85)"
                  style={{ pointerEvents: "none" }}
                >
                  {pct}%
                </text>
              </g>
            );
          })
        )}
      </svg>

      {caption && (
        <div
          style={{
            fontSize: 9,
            color: "var(--muted)",
            fontFamily: "monospace",
            marginTop: 4,
            textAlign: "center"
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
