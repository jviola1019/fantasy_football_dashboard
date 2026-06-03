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

/** Generational suffixes that should never be shown as a player's "last name". */
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/**
 * The display surname for a full name: the last real name token, skipping
 * generational suffixes. "Marvin Harrison Jr." → "Harrison", not "Jr.".
 * Used for compact labels (heatmap cells, league-pulse chips) where the prior
 * `name.split(" ").slice(-1)` grabbed the suffix instead of the family name.
 */
export function surname(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!NAME_SUFFIXES.has(tokens[i].toLowerCase())) return tokens[i];
  }
  return fullName;
}

export function fmt(n: number, decimals = 1): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : "—";
}

export function fmtPct(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

export function trendingLabel(momentum: number): string {
  if (momentum > 50) return "Very Positive";
  if (momentum > 20) return "Positive";
  if (momentum > -20) return "Neutral";
  if (momentum > -50) return "Negative";
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
