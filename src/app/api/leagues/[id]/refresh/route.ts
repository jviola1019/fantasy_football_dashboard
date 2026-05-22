import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { getLeagueCredentials, getLeagueForUser } from "@/lib/leagues";
import { EspnClient } from "@/lib/espn/client";
import { getLeague as getEspnLeague } from "@/lib/espn/league";
import { getLeague as getSleeperLeague, getRosters as getSleeperRosters } from "@/lib/sleeper";
import { normalizeEspnTrades, indexByEspnId } from "@/lib/trade/transactions";
import type { EspnTransaction } from "@/lib/espn/schemas";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const league = await getLeagueForUser(db, userId, id);
  if (!league) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (league.platform === "sleeper") {
    const [info, rosters] = await Promise.all([
      getSleeperLeague(league.externalLeagueId),
      getSleeperRosters(league.externalLeagueId)
    ]);
    return NextResponse.json({
      league: { id: league.id, label: league.label, platform: league.platform, season: league.season },
      info: { data: info.data, source: info.source },
      rosters: { data: rosters.data, source: rosters.source }
    });
  }

  const creds = await getLeagueCredentials(db, league.id);
  if (!creds) return NextResponse.json({ error: "missing credentials" }, { status: 412 });

  // Fetch team, roster, settings, and transaction data in one request.
  const client = new EspnClient({ credentials: creds });
  const result = await getEspnLeague(client, { leagueId: league.externalLeagueId, season: league.season }, [
    "mTeam",
    "mRoster",
    "mSettings",
    "mTransactions2"
  ]);

  // Grade any completed trades from the transaction payload. We do this on a
  // best-effort basis: if the value map is unavailable we just return an empty
  // list rather than failing the whole refresh.
  let gradedTrades: ReturnType<typeof normalizeEspnTrades> = [];
  try {
    const txns = (result.data?.transactions ?? []) as unknown as EspnTransaction[];
    // Use an empty value map — callers that need graded values should call the
    // trade-values endpoint separately. This at minimum makes the raw trade
    // presence visible in the response.
    gradedTrades = normalizeEspnTrades(txns, indexByEspnId(new Map()));
  } catch {
    // Non-fatal: trades are supplementary data
  }

  return NextResponse.json({
    league: { id: league.id, label: league.label, platform: league.platform, season: league.season },
    espn: { data: result.data, source: result.source },
    gradedTrades
  });
}
