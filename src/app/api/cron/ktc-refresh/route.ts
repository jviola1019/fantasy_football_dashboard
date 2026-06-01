import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/timingSafe";
import { fetchKtcRankings } from "@/lib/ktc/scrape";
import { insertKtcSnapshot, pruneOldKtcSnapshots } from "@/lib/ktc/snapshot";
import type { KtcVariant } from "@/lib/ktc/types";
import { redact, unwrap } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 60;

const KEEP_LAST_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Both KTC variants are refreshed on each run. Dynasty + redraft are
// scraped sequentially so we stay polite (one open connection at a time).
const VARIANTS: KtcVariant[] = ["dynasty", "redraft"];

interface VariantResult {
  variant: KtcVariant;
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

  // Run each variant under its own try so a failure in dynasty doesn't
  // lose the redraft snapshot (or vice versa).
  const results: VariantResult[] = [];
  for (const variant of VARIANTS) {
    try {
      const data = await fetchKtcRankings({ variant });
      const inserted = await insertKtcSnapshot({ variant, data });
      const pruned = await pruneOldKtcSnapshots(variant, KEEP_LAST_MS);
      results.push({
        variant,
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
        variant,
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
    { status: anyOk ? 200 : 502 }
  );
}
