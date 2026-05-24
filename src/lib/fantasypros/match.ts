import type { FpPlayer } from "./types";

// Match a Sleeper player record (id-keyed) to a FantasyPros ranking entry
// (name-keyed). Naive direct matching fails on ~5% of NFL players due to
// initials, suffixes, nicknames, and diacritics — so we normalize first and
// fall back through three lookup tiers (name+pos+team, then name+pos, then
// name alone) before giving up.

// Hand-curated nickname/alias overrides. The map key is the Sleeper full_name
// (lowercased, raw); value is the FantasyPros-style display name. Add entries
// here when a real player can't be matched any other way.
const NICKNAME_ALIASES: Record<string, string> = {
  "hollywood brown": "marquise brown",
  "kj osborn": "k.j. osborn",
  "dj moore": "d.j. moore",
  "aj brown": "a.j. brown",
  "jk dobbins": "j.k. dobbins",
  "dj chark": "d.j. chark",
  "cj stroud": "c.j. stroud",
  "bj baylor": "b.j. baylor"
};

// Team-code normalization. NFL has reshuffled franchises (OAK->LV in 2020,
// WAS->WSH then WAS again, SD->LAC, STL->LAR). Sleeper and FantasyPros
// occasionally disagree on the current code, especially for retained
// players. Map both alternates to the canonical code we use for matching.
const TEAM_ALIASES: Record<string, string> = {
  OAK: "LV",
  LVR: "LV",
  WSH: "WAS",
  SD: "LAC",
  STL: "LAR",
  JAC: "JAX"
};

const SUFFIX_RE = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;

/**
 * Lowercase, strip accents, drop punctuation that varies across feeds,
 * collapse whitespace, drop generational suffixes. The result is a
 * stable matching key.
 *
 * "Ja'Marr Chase" → "jamarr chase"
 * "D.K. Metcalf"  → "dk metcalf"
 * "Patrick Mahomes II" → "patrick mahomes"
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.,]/g, "")
    .replace(SUFFIX_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTeamCode(team: string | null | undefined): string | null {
  if (!team) return null;
  const upper = team.toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

export interface MatchableSleeperPlayer {
  player_id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
}

export type MatchTier = "name+pos+team" | "name+pos" | "name" | "alias";

export interface FpMatch {
  fp: FpPlayer;
  matchedBy: MatchTier;
}

export interface FpIndex {
  byNamePosTeam: Map<string, FpPlayer>;
  byNamePos: Map<string, FpPlayer>;
  byName: Map<string, FpPlayer>;
}

/**
 * Build the three-tier match index from a ranked player list. When two FP
 * entries collide on the same normalized key, the higher-ranked one wins
 * (rank_ecr is lower = better) so a fuzzy match still surfaces the
 * "obvious" player.
 */
export function buildFpIndex(players: FpPlayer[]): FpIndex {
  const byNamePosTeam = new Map<string, FpPlayer>();
  const byNamePos = new Map<string, FpPlayer>();
  const byName = new Map<string, FpPlayer>();
  // Sort by rank ascending so set-by-first-write semantics keeps the best.
  const sorted = [...players].sort((a, b) => a.rank_ecr - b.rank_ecr);
  for (const player of sorted) {
    const name = normalizePlayerName(player.player_name);
    const pos = player.player_position_id;
    const team = normalizeTeamCode(player.player_team_id);
    if (team) {
      const k = `${name}|${pos}|${team}`;
      if (!byNamePosTeam.has(k)) byNamePosTeam.set(k, player);
    }
    const k2 = `${name}|${pos}`;
    if (!byNamePos.has(k2)) byNamePos.set(k2, player);
    if (!byName.has(name)) byName.set(name, player);
  }
  return { byNamePosTeam, byNamePos, byName };
}

function sleeperDisplayName(player: MatchableSleeperPlayer): string {
  if (player.full_name && player.full_name.trim().length > 0) return player.full_name;
  return [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
}

/**
 * Resolve a Sleeper player to its FantasyPros ranking entry by walking
 * the match tiers. Returns null when no tier hit — typical for deep-bench
 * FA who aren't in FantasyPros' top 440.
 */
export function matchSleeperToFp(
  sleeper: MatchableSleeperPlayer,
  index: FpIndex
): FpMatch | null {
  const raw = sleeperDisplayName(sleeper);
  if (!raw) return null;
  const lowerRaw = raw.toLowerCase();
  // Alias override first — handles nicknames before any tier match.
  const aliased = NICKNAME_ALIASES[lowerRaw];
  const normalised = normalizePlayerName(aliased ?? raw);
  const pos = sleeper.position?.toUpperCase();
  const team = normalizeTeamCode(sleeper.team);

  if (pos && team) {
    const m = index.byNamePosTeam.get(`${normalised}|${pos}|${team}`);
    if (m) return { fp: m, matchedBy: aliased ? "alias" : "name+pos+team" };
  }
  if (pos) {
    const m = index.byNamePos.get(`${normalised}|${pos}`);
    if (m) return { fp: m, matchedBy: aliased ? "alias" : "name+pos" };
  }
  const m = index.byName.get(normalised);
  if (m) return { fp: m, matchedBy: aliased ? "alias" : "name" };
  return null;
}
