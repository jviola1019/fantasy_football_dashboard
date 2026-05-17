export function avg(values: number[]): number {
  return values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : Number.NaN;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function slug(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

export function fmt(n: number, decimals = 1): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : "—";
}

export function fmtPct(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

export function narrativeLabel(pressure: number): string {
  if (pressure > 50) return "Very Positive";
  if (pressure > 20) return "Positive";
  if (pressure > -20) return "Neutral";
  if (pressure > -50) return "Negative";
  return "Very Negative";
}

export function gradeFromScore(score: number): string {
  if (score > 15) return "A+";
  if (score > 8) return "A";
  if (score > 3) return "B+";
  if (score > -2) return "B";
  if (score > -7) return "C+";
  if (score > -14) return "C";
  return "D";
}
