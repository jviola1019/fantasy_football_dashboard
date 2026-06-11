"use client";

// Reliability (calibration) diagram. Plots observed outcome frequency vs
// mean forecast probability per bin. A perfectly calibrated forecaster
// lies on the diagonal identity line y = x.
//
// When no data is provided (no backtest has been run yet) the component
// renders an honest "Awaiting backtest data" placeholder rather than a
// blank chart — consistent with the <DataUnavailable> pattern.

import type { ReliabilityBin } from "@/lib/stats/distribution";

const W = 280;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 40, left: 44 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function scaleX(v: number) {
  return PAD.left + v * INNER_W;
}
function scaleY(v: number) {
  // SVG y increases downward; data y increases upward.
  return PAD.top + (1 - v) * INNER_H;
}

interface Props {
  bins?: ReliabilityBin[];
  /** Optional label shown below the chart */
  caption?: string;
}

export function ReliabilityDiagram({ bins, caption }: Props) {
  const hasBins = bins && bins.length > 0;

  return (
    <div style={{ display: "inline-block" }}>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label="Reliability diagram: observed frequency vs mean forecast probability"
        style={{ overflow: "visible" }}
      >
        {/* Axes */}
        <line
          x1={scaleX(0)}
          y1={scaleY(0)}
          x2={scaleX(1)}
          y2={scaleY(0)}
          stroke="var(--muted)"
          strokeWidth={1}
        />
        <line
          x1={scaleX(0)}
          y1={scaleY(0)}
          x2={scaleX(0)}
          y2={scaleY(1)}
          stroke="var(--muted)"
          strokeWidth={1}
        />

        {/* Identity line (y = x) */}
        <line
          x1={scaleX(0)}
          y1={scaleY(0)}
          x2={scaleX(1)}
          y2={scaleY(1)}
          stroke="var(--muted)"
          strokeWidth={1}
          strokeDasharray="4 3"
          aria-hidden="true"
        />

        {/* Axis tick labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <text
              x={scaleX(v)}
              y={scaleY(0) + 14}
              textAnchor="middle"
              fontSize={9}
              fill="var(--muted)"
            >
              {v.toFixed(2)}
            </text>
            <text
              x={scaleX(0) - 6}
              y={scaleY(v) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--muted)"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text
          x={W / 2}
          y={H - 2}
          textAnchor="middle"
          fontSize={9}
          fill="var(--muted)"
        >
          Mean forecast probability
        </text>
        <text
          x={8}
          y={PAD.top + INNER_H / 2}
          textAnchor="middle"
          fontSize={9}
          fill="var(--muted)"
          transform={`rotate(-90, 8, ${PAD.top + INNER_H / 2})`}
        >
          Observed frequency
        </text>

        {hasBins ? (
          /* Data points */
          bins.map((bin, i) => (
            <g key={i}>
              <circle
                cx={scaleX(bin.meanForecast)}
                cy={scaleY(bin.observedFreq)}
                r={Math.max(3, Math.min(8, Math.sqrt(bin.n)))}
                fill="var(--amber)"
                fillOpacity={0.8}
                stroke="var(--amber)"
                strokeWidth={1}
              >
                <title>
                  {`Forecast: ${bin.meanForecast.toFixed(3)}, Observed: ${bin.observedFreq.toFixed(3)}, n=${bin.n}`}
                </title>
              </circle>
            </g>
          ))
        ) : (
          /* Placeholder when no backtest data available */
          <text
            x={W / 2}
            y={PAD.top + INNER_H / 2}
            textAnchor="middle"
            fontSize={10}
            fill="var(--muted)"
          >
            Awaiting backtest data
          </text>
        )}
      </svg>

      {caption && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--muted)",
            marginTop: 6,
            maxWidth: W,
            textAlign: "left"
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
