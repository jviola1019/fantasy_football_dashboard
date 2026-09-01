/**
 * Cache the FantasyPros consensus rankings into the local database.
 *
 * `/mock-draft` renders an honest "rankings not loaded yet" state until a
 * snapshot exists, which is correct behaviour and useless for looking at the
 * page. In production the daily cron fills it; locally there is no cron, so this
 * does the same work through the same library functions the cron route calls.
 *
 *   npx tsx scripts/cache-rankings.ts
 */
import { fetchFpEcr } from "../src/lib/fantasypros/scrape";
import { insertRankingsSnapshot } from "../src/lib/fantasypros/snapshot";
import type { FpScoring } from "../src/lib/fantasypros/types";

const SCORINGS: FpScoring[] = ["PPR", "HALF", "STD"];

async function main(): Promise<void> {
  let ok = 0;
  for (const scoring of SCORINGS) {
    try {
      const data = await fetchFpEcr({ scoring });
      const inserted = await insertRankingsSnapshot({ scoring, data });
      const count = Array.isArray((data as { players?: unknown[] }).players)
        ? (data as { players: unknown[] }).players.length
        : 0;
      console.log(`cache-rankings: ${scoring} ${count} players, snapshot ${JSON.stringify(inserted).slice(0, 120)}`);
      ok += 1;
    } catch (err) {
      console.error(`cache-rankings: ${scoring} FAILED - ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (ok === 0) {
    console.error("cache-rankings: nothing was cached.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("cache-rankings failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
