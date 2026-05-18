import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { getLeagueCredentials, getLeagueForUser } from "@/lib/leagues";
import { EspnClient } from "@/lib/espn/client";
import { getLeague as getEspnLeague } from "@/lib/espn/league";
import { getLeague as getSleeperLeague, getRosters as getSleeperRosters } from "@/lib/sleeper";

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
  const client = new EspnClient({ credentials: creds });
  const result = await getEspnLeague(client, { leagueId: league.externalLeagueId, season: league.season }, [
    "mTeam",
    "mRoster",
    "mSettings"
  ]);
  return NextResponse.json({
    league: { id: league.id, label: league.label, platform: league.platform, season: league.season },
    espn: { data: result.data, source: result.source }
  });
}
