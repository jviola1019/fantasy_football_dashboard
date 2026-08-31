import { z } from "zod";

/**
 * FREE opportunity signal from nflverse snap counts (replaces any paid
 * snap-share / target-share feed). nflverse publishes per-player-week snap
 * counts as a CSV GitHub release asset (CC-BY, no key). `offense_pct` is the
 * fraction of offensive snaps a player was on the field for — a genuine
 * opportunity/role signal. We aggregate it to a recency-weighted 0–100 score
 * per player for joining onto PlayerMarketRecords.
 *
 * Endpoint:
 *   https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_<season>.csv
 */

const NFLVERSE_SNAPS_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);

export interface SnapRow {
  player: string;
  position: string;
  team: string;
  week: number;
  offensePct: number; // 0..1
}

export interface OpportunityScore {
  /** Recency-weighted snap share scaled to 0..100. */
  score: number;
  position: string;
  team: string;
  games: number;
}

/** Persisted payload: normalized-name → score. Validated on snapshot read/write. */
export const OpportunityMapSchema = z.record(
  z.string(),
  z.object({
    score: z.number().min(0).max(100),
    position: z.string(),
    team: z.string(),
    games: z.number().int().min(0)
  })
);
export type OpportunityMap = z.infer<typeof OpportunityMapSchema>;

/**
 * What actually gets persisted: the scores plus the SEASON THEY DESCRIBE.
 *
 * Audit 2026-08-31 (D-C). The cron resolves a season and falls back a year when
 * the current one has no data yet — verified live on 2026-08-31:
 * `snap_counts_2026.csv` returns 404 while `snap_counts_2025.csv` returns 200,
 * so the whole product was running on 2025 snap share. `usedSeason` was returned
 * in the cron's HTTP response and then discarded, because the payload had
 * nowhere to put it.
 *
 * The consequence was a true statement that misled: the envelope's freshness
 * check measures SNAPSHOT AGE, so a snapshot written last night containing
 * last season's data is `fresh`, and the assumption read "a real role/usage
 * proxy. Snapshot is 0 days old." Age and vintage are different facts, and a
 * product that shows one while implying the other is not traceable.
 *
 * A UNION, not a replacement: snapshots written before this change are a bare
 * scores record and must keep parsing, the same treatment `byeWeek` got when it
 * became nullable.
 */
export const OpportunityPayloadSchema = z.union([
  z.object({
    /** The nflverse season these snap shares come from, e.g. "2025". */
    dataSeason: z.string().min(4),
    scores: OpportunityMapSchema
  }),
  OpportunityMapSchema
]);
export type OpportunityPayload = z.infer<typeof OpportunityPayloadSchema>;

/** Normalise either payload shape to `{ dataSeason, scores }`. */
export function readOpportunityPayload(
  payload: OpportunityPayload
): { dataSeason: string | null; scores: OpportunityMap } {
  // Discriminated on `dataSeason` being a STRING, not on key presence. `in`
  // cannot separate these shapes: the legacy form is a Record whose keys are
  // arbitrary player names, so a key literally called "scores" is type-legal.
  // Only the value type distinguishes them — a legacy record's values are always
  // objects, never strings.
  if (payload && typeof payload === "object") {
    const maybe = payload as { dataSeason?: unknown; scores?: unknown };
    if (typeof maybe.dataSeason === "string" && maybe.scores && typeof maybe.scores === "object") {
      return { dataSeason: maybe.dataSeason, scores: maybe.scores as OpportunityMap };
    }
  }
  // Legacy snapshot: real scores, unknown vintage. `null` is the honest answer —
  // guessing the current season is exactly the error this change exists to fix.
  return { dataSeason: null, scores: payload as OpportunityMap };
}

/**
 * Normalize a player name for cross-source joining: lowercase, drop generational
 * suffixes (Jr/Sr/II/III/IV/V), strip everything but a–z. Mirrors the loose
 * matching used elsewhere so nflverse "A.J. Brown" joins "AJ Brown".
 */
export function normalizeOppName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
}

/**
 * Parse the nflverse snap_counts CSV. Tolerant of the simple comma layout
 * nflverse emits (no quoted/embedded commas in the columns we read). Keeps only
 * regular-season rows at fantasy-relevant offensive positions.
 */
export function parseSnapCounts(csv: string): SnapRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",");
  const idx = (name: string) => header.indexOf(name);
  const iPlayer = idx("player");
  const iPos = idx("position");
  const iTeam = idx("team");
  const iWeek = idx("week");
  const iType = idx("game_type");
  const iPct = idx("offense_pct");
  if (iPlayer < 0 || iPos < 0 || iPct < 0 || iWeek < 0) return [];

  const rows: SnapRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]!.split(",");
    const position = (c[iPos] ?? "").toUpperCase();
    if (!FANTASY_POSITIONS.has(position)) continue;
    if (iType >= 0 && (c[iType] ?? "") !== "REG") continue; // regular season only
    const pct = Number(c[iPct]);
    const week = Number(c[iWeek]);
    if (!Number.isFinite(pct) || !Number.isFinite(week)) continue;
    rows.push({
      player: c[iPlayer] ?? "",
      position: position === "FB" ? "RB" : position,
      team: (c[iTeam] ?? "").toUpperCase(),
      week,
      offensePct: Math.min(1, Math.max(0, pct))
    });
  }
  return rows;
}

/**
 * Aggregate snap rows into a per-player opportunity score (0..100). Later weeks
 * are weighted more (linear recency weight) so a rising role shows up. Score =
 * recency-weighted mean snap share × 100. Returns a normalized-name-keyed map.
 */
export function computeOpportunityScores(rows: SnapRow[]): OpportunityMap {
  const acc = new Map<
    string,
    { wsum: number; wpct: number; games: number; position: string; team: string; lastWeek: number }
  >();
  for (const r of rows) {
    const key = normalizeOppName(r.player);
    if (!key) continue;
    const w = Math.max(1, r.week); // recency weight = week number
    const cur = acc.get(key) ?? { wsum: 0, wpct: 0, games: 0, position: r.position, team: r.team, lastWeek: 0 };
    cur.wsum += w;
    cur.wpct += w * r.offensePct;
    cur.games += 1;
    if (r.week >= cur.lastWeek) {
      cur.lastWeek = r.week;
      cur.position = r.position;
      cur.team = r.team; // most recent team
    }
    acc.set(key, cur);
  }
  const out: OpportunityMap = {};
  for (const [key, v] of acc) {
    const score = v.wsum > 0 ? Math.round((v.wpct / v.wsum) * 100) : 0;
    out[key] = { score: Math.min(100, Math.max(0, score)), position: v.position, team: v.team, games: v.games };
  }
  return out;
}

/**
 * Fetch + parse + score nflverse opportunity for a season. Fails open (returns
 * an empty map) so a nflverse outage never blocks the dashboard — the panels
 * then keep declaring opportunity unavailable rather than fabricating it.
 */
export async function fetchOpportunity(
  season: string,
  fetcher: typeof fetch = fetch
): Promise<OpportunityMap> {
  try {
    const res = await fetcher(NFLVERSE_SNAPS_URL(season));
    if (!res.ok) return {};
    const csv = await res.text();
    return computeOpportunityScores(parseSnapCounts(csv));
  } catch {
    return {};
  }
}
