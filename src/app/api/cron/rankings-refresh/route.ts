import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/timingSafe";
import { fetchFpEcr } from "@/lib/fantasypros/scrape";
import { insertRankingsSnapshot, pruneOldRankings } from "@/lib/fantasypros/snapshot";
import type { FpScoring } from "@/lib/fantasypros/types";
import { redact, unwrap } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 60;

const KEEP_LAST_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Scoring variants to refresh on each cron run. Order matters only for
// reporting — all three are fetched serially to stay polite to FantasyPros.
const SCORINGS: FpScoring[] = ["PPR", "HALF", "STD"];

interface ScoringResult {
  scoring: FpScoring;
  ok: boolean;
  playerCount?: number;
  sizeBytes?: number;
  prunedCount?: number;
  snapshotId?: string;
  error?: string;
}

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (!safeEqual(auth ?? "", `Bearer ${expected}`)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Run each scoring variant under its own try so a failure in one
  // doesn't lose the snapshots for the others.
  const results: ScoringResult[] = [];
  for (const scoring of SCORINGS) {
    try {
      const data = await fetchFpEcr({ scoring });
      const inserted = await insertRankingsSnapshot({ scoring, data });
      const pruned = await pruneOldRankings(scoring, KEEP_LAST_MS);
      results.push({
        scoring,
        ok: true,
        playerCount: data.players.length,
        sizeBytes: inserted.sizeBytes,
        prunedCount: pruned,
        snapshotId: inserted.id
      });
    } catch (err) {
      const root = unwrap(err);
      const raw = root instanceof Error ? root.message : String(root);
      const code =
        root && typeof root === "object" && "code" in root && typeof (root as { code: unknown }).code === "string"
          ? (root as { code: string }).code
          : undefined;
      const name = root instanceof Error ? root.name : "Error";
      results.push({
        scoring,
        ok: false,
        error: redact(`[${name}${code ? ` ${code}` : ""}] ${raw}`)
      });
    }
  }

  const anyOk = results.some((r) => r.ok);
  const allOk = results.every((r) => r.ok);
  return NextResponse.json(
    {
      ok: allOk,
      partial: anyOk && !allOk,
      results,
      fetchedAt: new Date().toISOString()
    },
    // 200 if at least one scoring variant landed; 502 if all failed
    { status: anyOk ? 200 : 502 }
  );
}
