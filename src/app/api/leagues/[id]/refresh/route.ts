import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";
import { getLeagueCredentials, getLeagueForUser } from "@/lib/leagues";
import { EspnClient } from "@/lib/espn/client";
import { getLeague as getEspnLeague } from "@/lib/espn/league";
import { normalizeEspnTrades, indexByEspnId } from "@/lib/trade/transactions";
import type { EspnTransaction } from "@/lib/espn/schemas";
import { requireUser } from "@/lib/auth/requireUser";

export const runtime = "nodejs";

// User-facing league refresh. Returns the league record, every team's
// materialized roster (with real player names from the snapshot), and the
// signed-in user's specific roster as identified by the stored Sleeper
// username / ESPN SWID. ESPN responses additionally include best-effort
// trade grading from the transactions payload.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  // F-004: re-validate the session generation against the DB, not just the JWT.
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = user.id;

  const { id } = await params;
  const db = getDb();

  // Use the same data-loader the lifecycle cron uses so the API surface and
  // the rules engine see the same data shape (allRosters + myRoster, every
  // player normalized to PlayerMarketRecord, identified team via username/SWID).
  const snapshot = await fetchLeagueLive(userId, id, db);
  if (!snapshot) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ESPN-only: enrich with best-effort trade grading. The Sleeper path doesn't
  // surface raw transactions through fetchLeagueLive (yet), so we skip this.
  let gradedTrades: ReturnType<typeof normalizeEspnTrades> = [];
  if (snapshot.league.platform === "espn") {
    try {
      const league = await getLeagueForUser(db, userId, id);
      const creds = league ? await getLeagueCredentials(db, league.id) : null;
      if (league && creds) {
        const client = new EspnClient({ credentials: creds });
        const result = await getEspnLeague(
          client,
          { leagueId: league.externalLeagueId, season: league.season },
          ["mTransactions2"]
        );
        const txns = (result.data?.transactions ?? []) as unknown as EspnTransaction[];
        gradedTrades = normalizeEspnTrades(txns, indexByEspnId(new Map()));
      }
    } catch {
      // Non-fatal: trades are supplementary; an empty list is acceptable.
    }
  }

  // A failed upstream fetch must not return 200.
  //
  // Audit 2026-08-22, P1-2. `fetchLeagueLive` degrades rather than throwing: on
  // an upstream error it returns a snapshot with `failure` set and NO rosters.
  // This route then serialized that as a normal 200 with `teamCount: 0`, so a
  // caller following the documented "check res.ok" contract saw success and an
  // empty league — indistinguishable from a league that genuinely has no
  // rosters yet. The failure text was in the body, which no correct client
  // reads on a 2xx.
  //
  // 502 specifically: the request was well-formed and authorized, and the
  // upstream platform is what failed. The full body still ships, so the client
  // can show WHY rather than a bare status.
  const upstreamFailed = snapshot.failure !== null && snapshot.allRosters.length === 0;

  return NextResponse.json({
    league: {
      id: snapshot.league.id,
      label: snapshot.league.label,
      platform: snapshot.league.platform,
      season: snapshot.league.season,
      sleeperUsername: snapshot.league.sleeperUsername
    },
    teamCount: snapshot.allRosters.length,
    myTeamSize: snapshot.myRoster.length,
    // Each roster is an array of PlayerMarketRecord (id, name, position, team,
    // plus identity-only metric fields that the panel layer will mark as
    // unavailable since Sleeper provides no market metrics).
    allRosters: snapshot.allRosters,
    myRoster: snapshot.myRoster,
    source: snapshot.source,
    failure: snapshot.failure,
    // P0-3: a roster substitution has to reach the caller, not just the UI.
    identityResolved: snapshot.identityResolved,
    identityNote: snapshot.identityNote,
    gradedTrades
  }, upstreamFailed ? { status: 502 } : undefined);
}
