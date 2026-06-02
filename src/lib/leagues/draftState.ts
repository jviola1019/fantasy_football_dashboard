import type { PlayerMarketRecord } from "../governance";

/**
 * Whether a league's draft has happened yet. Drives which player set the
 * market-facing panels show: `pre` → the whole draftable universe, `post` →
 * only free agents, `unknown` → fall back to the user's own roster.
 */
export type DraftState = "pre" | "post" | "unknown";

/**
 * Sleeper draft-state from the league + draft objects, with an empty-roster
 * fallback. Sleeper `league.status` is the authoritative signal
 * ("pre_draft" | "drafting" | "in_season" | "complete"); the draft object's
 * `status` is the backup; if neither is usable we infer from roster fill
 * (no rostered players ⇒ undrafted ⇒ pre).
 */
export function detectSleeperDraftState(
  leagueStatus: string | null | undefined,
  draftStatus: string | null | undefined,
  anyRosterNonEmpty: boolean
): DraftState {
  const ls = (leagueStatus ?? "").toLowerCase();
  if (ls === "pre_draft" || ls === "drafting") return "pre";
  if (ls === "in_season" || ls === "complete") return "post";

  const ds = (draftStatus ?? "").toLowerCase();
  if (ds === "complete") return "post";
  if (ds === "pre_draft" || ds === "drafting") return "pre";

  // No usable status string — infer from roster fill.
  return anyRosterNonEmpty ? "post" : "pre";
}

/**
 * ESPN has no explicit draft-status string, so infer from roster fill: a
 * league whose teams are (mostly) empty hasn't drafted. Uses the median
 * roster size vs. the expected size so one stray empty team doesn't flip it.
 * Returns `unknown` only when there are no teams or no expected size to compare.
 */
export function detectEspnDraftState(
  allRosters: PlayerMarketRecord[][],
  expectedRosterSize: number
): DraftState {
  if (allRosters.length === 0) return "unknown";
  const sizes = allRosters.map((r) => r.length).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  if (expectedRosterSize <= 0) return median > 0 ? "post" : "pre";
  return median >= expectedRosterSize / 2 ? "post" : "pre";
}

/** True when at least one roster has a player (used by the Sleeper detector). */
export function anyRosterNonEmpty(allRosters: PlayerMarketRecord[][]): boolean {
  return allRosters.some((r) => r.length > 0);
}
