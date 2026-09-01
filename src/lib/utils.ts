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

/**
 * Age of `iso` as of `nowIso`, e.g. "3h ago" / "2d ago".
 *
 * Both ends are explicit on purpose. The obvious signature takes only the
 * timestamp and calls `Date.now()` internally — which would produce a different
 * string on the server than on the client milliseconds later, and React would
 * report a hydration mismatch on a page that is otherwise deterministic.
 * Callers pass `envelope.generatedAt`, so the age is stated relative to a single
 * declared render instant that is itself visible in the governance banner.
 *
 * Returns null for an unparseable input rather than "NaN ago" — a headline
 * whose age cannot be stated is dropped upstream, and this is the second guard.
 */
export function relativeAge(iso: string, nowIso: string): string | null {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  const mins = Math.round((now - then) / 60000);
  // A clock skew of a few minutes between ESPN and this host is normal and is
  // not news from the future; anything ahead of "now" reads as just now.
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
