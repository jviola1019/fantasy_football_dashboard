import { z } from "zod";
import type { SourceMeta } from "../governance";
import { unavailableSource } from "../governance";
import type { LeagueFormat } from "./format";

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
  return (
    "https://api.fantasycalc.com/values/current" +
    `?isDynasty=false&numQbs=${format.numQbs}&numTeams=${format.numTeams}&ppr=${format.ppr}`
  );
}

/** Map a validated FantasyCalc payload into a sleeperId-keyed PlayerValue map. */
export function parseFantasyCalc(raw: unknown): Map<string, PlayerValue> {
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
      value: e.redraftValue ?? e.value,
      overallRank: e.overallRank,
      positionRank: e.positionRank,
      trend30Day: e.trend30Day ?? 0
    });
  }
  return map;
}

/** Fetch live trade values, governance-wrapped. DynastyProcess fallback is added in Task 4. */
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
  } catch (err) {
    return {
      values: new Map(),
      source: unavailableSource(
        "FantasyCalc redraft values",
        err instanceof Error ? err.message : String(err)
      )
    };
  }
}
