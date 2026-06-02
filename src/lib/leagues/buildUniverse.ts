import type { PlayerMarketRecord } from "../governance";
import type { SleeperPlayersMap } from "../sleeper/schemas";
import type { FpEcrData } from "../fantasypros/types";
import { sleeperPlayerToRecord } from "../normalize";
import { enrichRoster, buildFpIndex, type EnrichOptions } from "../fantasypros/enrich";

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/**
 * Build the full draftable player universe for a league: every active,
 * fantasy-relevant player from the Sleeper players snapshot, enriched with
 * FantasyPros consensus value/momentum via the same `enrichRoster` path used
 * for the user's own roster.
 *
 * CRITICAL: the universe is keyed off the **Sleeper** players map so its record
 * ids are `sleeper:<id>` — the SAME id space as `allRosters` (also built via
 * `sleeperPlayerToRecord`). Building it from `fpDataToRecords` instead would
 * produce `fp:<id>` ids and the free-agent subtraction below would silently
 * match nothing.
 */
export function buildLeagueUniverse(
  playersMap: SleeperPlayersMap,
  rankings: FpEcrData,
  options: EnrichOptions
): PlayerMarketRecord[] {
  const records: PlayerMarketRecord[] = [];
  for (const [id, player] of Object.entries(playersMap)) {
    if (player.active === false) continue;
    const positions = player.fantasy_positions ?? (player.position ? [player.position] : []);
    if (!positions.some((p) => FANTASY_POSITIONS.has(p))) continue;
    const record = sleeperPlayerToRecord(id, player, { source: options.rankingsSource });
    if (record) records.push(record);
  }
  const index = buildFpIndex(rankings.players);
  return enrichRoster(records, rankings, index, options);
}

/**
 * Free agents = the league universe minus every player rostered on ANY team
 * (the union of `allRosters`). Post-draft this is the waiver/market pool; the
 * id sets match because both sides come from `sleeperPlayerToRecord`.
 */
export function buildFreeAgents(
  universe: PlayerMarketRecord[],
  allRosters: PlayerMarketRecord[][]
): PlayerMarketRecord[] {
  const rostered = new Set<string>();
  for (const roster of allRosters) {
    for (const p of roster) rostered.add(p.id);
  }
  return universe.filter((p) => !rostered.has(p.id));
}
