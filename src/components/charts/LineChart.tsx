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
  const baseline = padT + innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`area-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {/* Horizontal grid lines */}
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padL} x2={W - padR}
          y1={padT + t * innerH} y2={padT + t * innerH}
          stroke="rgba(123,183,206,0.07)" strokeWidth="1"
        />
      ))}

      {/* Area fills */}
      {series.map((s, si) => {
        const pts = s.points
          .map((v, i) => `${px(i)},${py(v)}`)
          .join(" ");
        const first = `${px(0)},${baseline}`;
        const last = `${px(s.points.length - 1)},${baseline}`;
        return (
          <polygon
            key={`area-${si}`}
            points={`${first} ${pts} ${last}`}
            fill={`url(#area-fill-${si})`}
          />
        );
      })}

      {/* Lines and dots */}
      {series.map((s, si) => (
        <g key={`series-${si}`}>
          <polyline
            points={s.points.map((v, i) => `${px(i)},${py(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth="1.8"
            opacity="0.9"
          />
          {s.points.map((v, i) => (
            <circle key={i} cx={px(i)} cy={py(v)} r="2.2" fill={s.color} opacity="0.95" />
          ))}
        </g>
      ))}

      {/* X-axis labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={px(i)} y={H - 6}
          textAnchor="middle" fontSize="9"
          fill="rgba(122,136,148,0.75)"
        >
          {l}
        </text>
      ))}
    </svg>
  );
}
