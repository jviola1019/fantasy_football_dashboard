"use server";

import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues, getLeagueCredentials, type LeagueRecord } from "@/lib/leagues";
import { fetchTradeValues, type PlayerValue } from "@/lib/trade/values";
import {
  fetchSleeperLeagueTrades,
  fetchEspnLeagueTrades,
  type GradedTrade
} from "@/lib/trade/transactions";
import { DEFAULT_FORMAT, type LeagueFormat } from "@/lib/trade/format";
import { EspnClient } from "@/lib/espn/client";

export interface TradeValuesPayload {
  players: PlayerValue[];
  format: LeagueFormat;
  available: boolean;
  note: string;
}

/** The logged-in user's first connected league, or null. */
async function firstLeague(): Promise<LeagueRecord | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const leagues = await listLeagues(getDb(), userId);
  return leagues[0] ?? null;
}

/** Load the trade value pool, using the connected league's format when available. */
export async function loadTradeValues(): Promise<TradeValuesPayload> {
  const league = await firstLeague();
  const format = league?.settings ?? DEFAULT_FORMAT;
  const data = await fetchTradeValues(format);
  return {
    players: [...data.values.values()].sort((a, b) => b.value - a.value),
    format,
    available: data.values.size > 0,
    note: data.source.failure ?? data.source.source
  };
}

/** Load and grade recent real trades from the user's connected league (Sleeper or ESPN). */
export async function loadLeagueTrades(): Promise<GradedTrade[]> {
  const league = await firstLeague();
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
