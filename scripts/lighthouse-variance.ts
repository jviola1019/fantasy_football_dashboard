/**
 * Report how NOISY the Lighthouse measurement was, per URL.
 *
 * WHY THIS EXISTS (audit 2026-08-23).
 *
 * `lighthouserc.json` used to collect `numberOfRuns: 1`. A single sample of a
 * metric whose local spread was measured at 90 / 82 / 78 on identical code is
 * not a measurement, it is a draw — and the audit scorecard could not honestly
 * score performance because of it.
 *
 * Five runs and a median assertion fix the estimator. This script fixes the
 * REPORTING: it prints each run, the median, and the spread, so every CI run
 * says out loud how much of its own number is noise. Without that, "the gate
 * passed" is indistinguishable from "the gate got a lucky draw" — the same
 * class of green-check-that-isn't-checking this audit has catalogued nine times.
 *
 * It asserts nothing and never fails the build. Its whole job is to make the
 * uncertainty visible so a threshold can be chosen from evidence.
 *
 *   npx tsx scripts/lighthouse-variance.ts [outputDir]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "reports/lighthouse";

interface ManifestEntry {
  url: string;
  isRepresentativeRun: boolean;
  jsonPath: string;
  summary: Record<string, number>;
}

/** Read without an existsSync pre-check — no TOCTOU window (js/file-system-race). */
function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function main(): void {
  const raw = readIfPresent(join(DIR, "manifest.json"));
  if (!raw) {
    // Not a failure: the collector may not have run. Say which, rather than
    // printing an empty table that reads like a clean result.
    const listing = (() => {
      try {
        return readdirSync(DIR).join(", ");
      } catch {
        return "(directory absent)";
      }
    })();
    console.log(`lighthouse-variance: no manifest.json in ${DIR} — nothing was collected. Contents: ${listing}`);
    return;
  }

  const entries = JSON.parse(raw) as ManifestEntry[];
  const byUrl = new Map<string, ManifestEntry[]>();
  for (const e of entries) byUrl.set(e.url, [...(byUrl.get(e.url) ?? []), e]);

  const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

  console.log(`lighthouse-variance — ${entries.length} runs across ${byUrl.size} URLs\n`);
  for (const [url, runs] of byUrl) {
    console.log(url);
    for (const cat of CATEGORIES) {
      const scores = runs
        .map((r) => r.summary?.[cat])
        .filter((v): v is number => typeof v === "number")
        .map((v) => Math.round(v * 100));
      if (scores.length === 0) continue;
      const spread = Math.max(...scores) - Math.min(...scores);
      // A spread this wide means the single-run number was a coin flip. Named
      // explicitly so nobody has to work it out from the digits.
      const flag = spread >= 5 ? "  <-- NOISY" : "";
      console.log(
        `  ${cat.padEnd(15)} runs [${scores.join(", ")}]  median ${median(scores)}  spread ${spread}${flag}`
      );
    }
    console.log("");
  }

  console.log(
    "Assertions run against the MEDIAN of these runs (lighthouserc.json\n" +
      "`aggregationMethod: median`). A category with a wide spread cannot support\n" +
      "a tight threshold, and the scorecard says so rather than quoting one run."
  );
}

main();
