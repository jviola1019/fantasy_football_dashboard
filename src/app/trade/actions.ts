"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { getDb } from "@/db";
import { getLeagueCredentials } from "@/lib/leagues";
import { resolveActiveLeague, type ActiveLeagueResolution } from "@/lib/activeLeague";
import type { SourceMeta } from "@/lib/governance";
import { fetchTradeValues, type PlayerValue } from "@/lib/trade/values";
import {
  fetchSleeperLeagueTrades,
  fetchEspnLeagueTrades,
  type GradedTrade
} from "@/lib/trade/transactions";
import { DEFAULT_FORMAT, type LeagueFormat } from "@/lib/trade/format";
import { EspnClient } from "@/lib/espn/client";

/**
 * Which league these values describe. Rendered by Trade Center so the numbers
 * are never anonymous — a value pool is only meaningful next to the league
 * whose size, scoring and horizon produced it.
 */
export interface TradeLeagueIdentity {
  id: string;
  label: string;
  platform: "sleeper" | "espn";
  season: number;
  reason: ActiveLeagueResolution["reason"];
  leagueCount: number;
}

export interface TradeValuesPayload {
  players: PlayerValue[];
  format: LeagueFormat;
  available: boolean;
  note: string;
  /** null when no league is connected — the demo/default format is in use. */
  league: TradeLeagueIdentity | null;
  /**
   * Full lineage of the trade-value source (FantasyCalc/KTC/DynastyProcess) so
   * the Trade Center can render the same source · freshness · confidence badge
   * as every other panel — these values come from a DIFFERENT upstream than the
   * envelope the route banner describes (audit 2026-07-08 F-02).
   */
  source: SourceMeta;
}

/**
 * The league this request operates on (audit P2 §8).
 *
 * This used to be `firstLeague()` returning `leagues[0]`, which ignored the
 * header's league switcher entirely. A user with several leagues could select
 * their superflex dynasty league and be shown trade values priced for a
 * different one — silently, and with the correct-looking league name rendered
 * in the banner above the numbers. Every other route already honours the
 * cookie via `resolveActiveLeague`; Trade Center simply did not.
 */
async function activeLeague(): Promise<ActiveLeagueResolution | null> {
  const user = await requireUser();
  if (!user) return null;
  return resolveActiveLeague(user.id, getDb());
}

/** Describe which league produced these numbers, so the UI need not guess. */
function identify(active: ActiveLeagueResolution | null): TradeLeagueIdentity | null {
  if (!active) return null;
  const { league, reason, leagues } = active;
  return {
    id: league.id,
    label: league.label,
    platform: league.platform,
    season: league.season,
    reason,
    leagueCount: leagues.length
  };
}

/** Load the trade value pool, using the connected league's format when available. */
export async function loadTradeValues(): Promise<TradeValuesPayload> {
  const active = await activeLeague();
  const format = active?.league.settings ?? DEFAULT_FORMAT;
  const data = await fetchTradeValues(format);
  return {
    players: [...data.values.values()].sort((a, b) => b.value - a.value),
    format,
    available: data.values.size > 0,
    note: data.source.failure ?? data.source.source,
    source: data.source,
    league: identify(active)
  };
}

/** Load and grade recent real trades from the user's connected league (Sleeper or ESPN). */
export async function loadLeagueTrades(): Promise<GradedTrade[]> {
  const active = await activeLeague();
  const league = active?.league;
  if (!league) return [];
  const format = league.settings ?? DEFAULT_FORMAT;
  const { values } = await fetchTradeValues(format);
  if (values.size === 0) return [];
  if (league.platform === "sleeper") {
    return fetchSleeperLeagueTrades(league.externalLeagueId, values);
  }
  const creds = await getLeagueCredentials(getDb(), league.id);
  if (!creds) return [];
  const client = new EspnClient({ credentials: creds });
  return fetchEspnLeagueTrades(
    client,
    { leagueId: league.externalLeagueId, season: league.season },
    values
  );
}
