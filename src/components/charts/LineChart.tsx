type Series = { label: string; color: string; points: number[] };

type LineChartProps = {
  series: Series[];
  labels: string[];
  height?: number;
};

export function LineChart({ series, labels, height = 130 }: LineChartProps) {
  const W = 380;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 22;

  const allVals = series.flatMap((s) => s.points);
  const minV = Math.min(...allVals, 0);
  const maxV = Math.max(...allVals, 1);
  const range = maxV - minV || 1;
  const maxN = Math.max(...series.map((s) => s.points.length), 2);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const px = (i: number) => padL + (i / (maxN - 1)) * innerW;
  const py = (v: number) => padT + (1 - (v - minV) / range) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true" style={{ display: "block" }}>
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padL}
          x2={W - padR}
          y1={padT + t * innerH}
          y2={padT + t * innerH}
          stroke="rgba(214,226,226,0.07)"
          strokeWidth="1"
        />
      ))}
      {series.map((s) => (
        <g key={s.label}>
          <polyline
            points={s.points.map((v, i) => `${px(i)},${py(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            opacity="0.85"
          />
          {s.points.map((v, i) => (
            <circle key={i} cx={px(i)} cy={py(v)} r="2" fill={s.color} opacity="0.9" />
          ))}
        </g>
      ))}
      {labels.map((l, i) => (
        <text
          key={i}
          x={px(i)}
          y={H - 6}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(141,154,160,0.75)"
        >
          {l}
        </text>
      ))}
    </svg>
  );
}
