import { z } from "zod";
import type { SourceMeta } from "../governance";
import { evaluateFreshness, unavailableSource } from "../governance";
import type { LeagueFormat } from "./format";
import { getLatestKtcSnapshot } from "../ktc/snapshot";
import type { KtcVariant } from "../ktc/types";
import type { LeagueType } from "./format";

/**
 * Which KTC value scale a league should use (audit 2026-08-06 F-010).
 *
 * This was a module CONSTANT pinned to "redraft" — the old comment even said
 * "for dynasty we want dynasty, mapping is trivial" and then never did it. The
 * cost was real: the ktc-refresh cron scrapes, stores and prunes the DYNASTY
 * snapshot every single day, and nothing ever read it (getLatestKtcSnapshot
 * ("dynasty") had zero call sites). Dynasty leagues were priced with redraft
 * values while their correct data sat unused in the database.
 *
 * Keeper leagues intentionally use redraft values: only a small number of
 * players carry over, so the marginal player is valued for THIS season.
 */
export function ktcVariantForLeague(format: LeagueFormat): KtcVariant {
  return format.leagueType === "dynasty" ? "dynasty" : "redraft";
}

// KTC snapshots are written by a daily cron (09:00 UTC); within 30h
// (24h cadence + buffer) the snapshot is the expected state, not stale.
const KTC_SNAPSHOT_TTL_SECONDS = 30 * 3600;

export interface PlayerValue {
  sleeperId: string | null;
  espnId: string | null;
  name: string;
  position: string;
  team: string | null;
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
}

export interface TradeValueData {
  values: Map<string, PlayerValue>;
  source: SourceMeta;
}

const FantasyCalcEntrySchema = z.object({
  player: z.object({
    name: z.string(),
    position: z.string(),
    maybeTeam: z.string().nullish(),
    sleeperId: z.union([z.string(), z.number()]).nullish(),
    espnId: z.union([z.string(), z.number()]).nullish()
  }),
  value: z.number(),
  redraftValue: z.number().nullish(),
  overallRank: z.number(),
  positionRank: z.number(),
  trend30Day: z.number().nullish()
});
const FantasyCalcResponseSchema = z.array(FantasyCalcEntrySchema);

const FANTASYCALC_TTL_SECONDS = 43_200; // 12h

export function buildFantasyCalcUrl(format: LeagueFormat): string {
  // isDynasty was a hardcoded literal `false` (F-010), so a dynasty league was
  // handed redraft values by the API itself, not just by our variant choice.
  const isDynasty = format.leagueType === "dynasty";
  return (
    "https://api.fantasycalc.com/values/current" +
    `?isDynasty=${isDynasty}&numQbs=${format.numQbs}&numTeams=${format.numTeams}&ppr=${format.ppr}`
  );
}

/**
 * Map a validated FantasyCalc payload into a sleeperId-keyed PlayerValue map.
 *
 * `leagueType` decides which column to read: `redraftValue` prices a player for
 * this season, `value` is the dynasty (long-term) figure. Previously this always
 * preferred `redraftValue`, which silently discarded the dynasty pricing even
 * when the dynasty endpoint had been queried.
 */
export function parseFantasyCalc(
  raw: unknown,
  leagueType: LeagueType = "redraft"
): Map<string, PlayerValue> {
  const entries = FantasyCalcResponseSchema.parse(raw);
  const map = new Map<string, PlayerValue>();
  for (const e of entries) {
    const sleeperId = e.player.sleeperId != null ? String(e.player.sleeperId) : null;
    if (!sleeperId) continue;
    map.set(sleeperId, {
      sleeperId,
      espnId: e.player.espnId != null ? String(e.player.espnId) : null,
      name: e.player.name,
      position: e.player.position,
      team: e.player.maybeTeam ?? null,
      value: leagueType === "dynasty" ? (e.value ?? e.redraftValue) : (e.redraftValue ?? e.value),
      overallRank: e.overallRank,
      positionRank: e.positionRank,
      trend30Day: e.trend30Day ?? 0
    });
  }
  return map;
}

const DYNASTYPROCESS_CSV_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";

/**
 * Parse the DynastyProcess values.csv text into a "<pos>-<name>"-keyed map.
 *
 * NOTE: Every entry is returned with `sleeperId: null` and `espnId: null`
 * because DynastyProcess rows carry no platform IDs. When FantasyCalc is down
 * and this fallback is active, the Trade Builder (search-based) still works
 * because it matches by name. However, `loadLeagueTrades` joins executed
 * transactions by `sleeperId`/`espnId`, so it will grade nothing — an honest
 * degradation rather than fabricated grades.
 */
export function parseDynastyProcessCsv(csv: string, format: LeagueFormat): Map<string, PlayerValue> {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(",");
  const col = (name: string) => header.indexOf(name);
  const iName = col("player");
  const iPos = col("pos");
  const iTeam = col("team");
  const iVal = format.numQbs === 2 ? col("value_2qb") : col("value_1qb");
  const map = new Map<string, PlayerValue>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const name = cells[iName];
    const pos = cells[iPos];
    const value = Number(cells[iVal]);
    if (!name || !pos || !Number.isFinite(value)) continue;
    map.set(`${pos.toLowerCase()}-${name.toLowerCase()}`, {
      sleeperId: null,
      espnId: null,
      name,
      position: pos,
      team: cells[iTeam] ?? null,
      value,
      overallRank: 0,
      positionRank: 0,
      trend30Day: 0
    });
  }
  return map;
}

/** Fetch the DynastyProcess fallback values. */
export async function fetchDynastyProcessValues(format: LeagueFormat): Promise<Map<string, PlayerValue>> {
  const res = await fetch(DYNASTYPROCESS_CSV_URL, { next: { revalidate: FANTASYCALC_TTL_SECONDS } });
  if (!res.ok) throw new Error(`DynastyProcess HTTP ${res.status}`);
  return parseDynastyProcessCsv(await res.text(), format);
}

// KTC -> PlayerValue map. Keyed by "<pos>-<name>" (lowercased, name-normalized
// only for separator/case) to match DynastyProcess's join shape. KTC has no
// sleeperId/espnId, so trade-grading by id falls through to DynastyProcess
// behavior — Trade Builder (search-based) still works.
export async function fetchKtcValues(
  format: LeagueFormat,
  variant: KtcVariant = ktcVariantForLeague(format)
): Promise<{ values: Map<string, PlayerValue>; fetchedAt: string }> {
  const snapshot = await getLatestKtcSnapshot(variant);
  if (!snapshot) throw new Error(`KTC ${variant} snapshot not cached`);
  const map = new Map<string, PlayerValue>();
  for (const p of snapshot.data.players) {
    // Pick the right value scale for the league's QB count. Superflex
    // leagues should consult oneQBValues even though the format is 2QB —
    // KTC's "superflexValues" overstates RB/WR values by the QB premium,
    // which would skew non-QB pricing in a Superflex builder. We err on
    // the side of position-neutral; a future commit can branch by format.
    const value = format.numQbs === 2 && p.superflexValues
      ? p.superflexValues.startSitValue
      : p.oneQBValues.startSitValue;
    if (!Number.isFinite(value)) continue;
    const key = `${p.position.toLowerCase()}-${p.playerName.toLowerCase()}`;
    map.set(key, {
      sleeperId: null,
      espnId: null,
      name: p.playerName,
      position: p.position,
      team: p.team ?? null,
      value,
      overallRank: p.oneQBValues.startSitOverallRank ?? 0,
      positionRank: p.oneQBValues.startSitPositionalRank ?? 0,
      trend30Day: p.oneQBValues.overall7DayTrend ?? 0
    });
  }
  // Surface the snapshot's REAL timestamp so the caller can derive freshness
  // from actual age instead of stamping "now" (DAT-03).
  return { values: map, fetchedAt: snapshot.fetchedAt.toISOString() };
}

/** Fetch live trade values, governance-wrapped. */
export async function fetchTradeValues(format: LeagueFormat): Promise<TradeValueData> {
  const url = buildFantasyCalcUrl(format);
  try {
    const res = await fetch(url, { next: { revalidate: FANTASYCALC_TTL_SECONDS } });
    if (!res.ok) throw new Error(`FantasyCalc HTTP ${res.status}`);
    const values = parseFantasyCalc(await res.json());
    return {
      values,
      source: {
        source: "FantasyCalc redraft values",
        fetchedAt: new Date().toISOString(),
        ttlSeconds: FANTASYCALC_TTL_SECONDS,
        freshness: "fresh",
        confidence: 0.9,
        validation: "valid",
        missingFields: [],
        assumptions: [`Format: ${format.numTeams}-team, ${format.numQbs}QB, ${format.ppr} PPR.`],
        failure: null
      }
    };
  } catch (primaryErr) {
    // Secondary: KeepTradeCut cached snapshot. Daily cron at 09:00 UTC.
    try {
      const { values, fetchedAt } = await fetchKtcValues(format);
      return {
        values,
        source: {
          source: "KeepTradeCut redraft values (secondary)",
          // Real snapshot timestamp; freshness derived from actual age against
          // the daily cron cadence (30h = 24h cadence + buffer), not hardcoded.
          fetchedAt,
          ttlSeconds: KTC_SNAPSHOT_TTL_SECONDS,
          freshness: evaluateFreshness(fetchedAt, KTC_SNAPSHOT_TTL_SECONDS),
          confidence: 0.75,
          validation: "valid",
          missingFields: ["sleeperId"],
          assumptions: [
            "FantasyCalc unavailable; using KeepTradeCut consensus values keyed by name.",
            `Primary failure: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`
          ],
          failure: null
        }
      };
    } catch (ktcErr) {
      // Tertiary: DynastyProcess CSV.
      try {
        const values = await fetchDynastyProcessValues(format);
        return {
          values,
          source: {
            source: "DynastyProcess values (tertiary fallback)",
            // Live HTTP fetch that just succeeded — "now" is the real timestamp
            // and "fresh" the honest label; confidence 0.6 conveys lower trust.
            fetchedAt: new Date().toISOString(),
            ttlSeconds: FANTASYCALC_TTL_SECONDS,
            freshness: "fresh",
            confidence: 0.6,
            validation: "valid",
            missingFields: ["sleeperId"],
            assumptions: [
              "FantasyCalc + KTC both unavailable; using DynastyProcess ECR-derived values keyed by name.",
              `Primary failure: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`,
              `Secondary failure: ${ktcErr instanceof Error ? ktcErr.message : String(ktcErr)}`
            ],
            failure: null
          }
        };
      } catch (fallbackErr) {
        return {
          values: new Map(),
          source: unavailableSource(
            "Trade values",
            `All three value sources failed — FantasyCalc: ${
              primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
            }; KTC: ${
              ktcErr instanceof Error ? ktcErr.message : String(ktcErr)
            }; DynastyProcess: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }`
          )
        };
      }
    }
  }
}
