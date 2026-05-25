import { normalizePlayerName, normalizeTeamCode } from "../fantasypros/match";
import type { KtcPlayer } from "./types";

// KTC publishes its own internal `playerID`, NOT Sleeper or ESPN ids. We
// match into the existing PlayerValue map by normalized (name, position) —
// reusing FP's normalizePlayerName so suffix/diacritic/punctuation
// stripping stays identical across the two adapters. NFL team aliasing
// (OAK<->LV, WSH<->WAS, SD<->LAC, STL<->LAR, JAC<->JAX) also reuses the
// FP map.

// Three-tier index, same shape as FP's matcher. byNamePosTeam is most
// specific; falls through to byNamePos when team is null or differs;
// final fallback is byName for unique names where position metadata
// might be missing.
export interface KtcIndex {
  byNamePosTeam: Map<string, KtcPlayer>;
  byNamePos: Map<string, KtcPlayer>;
  byName: Map<string, KtcPlayer>;
}

const PMR_TO_KTC_POS: Record<string, string> = {
  // KTC uses "DST" for defenses (so do we for storage); FantasyPros uses
  // "DST" but PMR uses "DEF". Map PMR positions to KTC's spelling.
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DST"
};

/**
 * Build a three-tier KTC lookup index. When two KTC players normalize to
 * the same name+pos+team key, the one with the higher startSitValue wins
 * — sort by descending value and rely on set-first-write semantics.
 */
export function buildKtcIndex(players: readonly KtcPlayer[]): KtcIndex {
  const byNamePosTeam = new Map<string, KtcPlayer>();
  const byNamePos = new Map<string, KtcPlayer>();
  const byName = new Map<string, KtcPlayer>();
  const sorted = [...players].sort(
    (a, b) => b.oneQBValues.startSitValue - a.oneQBValues.startSitValue
  );
  for (const player of sorted) {
    const name = normalizePlayerName(player.playerName);
    const pos = player.position;
    const team = normalizeTeamCode(player.team ?? null);
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

export interface KtcMatchInput {
  /** PlayerMarketRecord's `position` enum (QB | RB | WR | TE | K | DEF). */
  position?: string | null;
  team?: string | null;
  /** Player display name, e.g. "Ja'Marr Chase". */
  name: string;
}

export interface KtcMatch {
  player: KtcPlayer;
  matchedBy: "name+pos+team" | "name+pos" | "name";
}

/**
 * Resolve a PlayerMarketRecord-shape input to its KTC entry via the
 * three-tier index. Returns null when no tier hits — typical for deep
 * bench players KTC doesn't rank.
 */
export function matchPmrToKtc(input: KtcMatchInput, index: KtcIndex): KtcMatch | null {
  if (!input.name) return null;
  const name = normalizePlayerName(input.name);
  const ktcPos = input.position ? PMR_TO_KTC_POS[input.position.toUpperCase()] : undefined;
  const team = normalizeTeamCode(input.team);

  if (ktcPos && team) {
    const m = index.byNamePosTeam.get(`${name}|${ktcPos}|${team}`);
    if (m) return { player: m, matchedBy: "name+pos+team" };
  }
  if (ktcPos) {
    const m = index.byNamePos.get(`${name}|${ktcPos}`);
    if (m) return { player: m, matchedBy: "name+pos" };
  }
  const m = index.byName.get(name);
  if (m) return { player: m, matchedBy: "name" };
  return null;
}
