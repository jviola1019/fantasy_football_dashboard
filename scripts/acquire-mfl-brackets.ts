/**
 * Acquire and ARCHIVE actual playoff-bracket participants for every holdout
 * league (audit §19, protocol 3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * Protocols 1 and 2 INFER the outcome from `standings rank <= P`. Validating that
 * against real brackets showed it is wrong for **33% of leagues** (28 of 84
 * judgeable), and wrong in a structured way: 23 of 28 are off by exactly one
 * team, the signature of a division winner taking an automatic berth ahead of a
 * better-record wildcard.
 *
 * A wrong outcome corrupts every metric, and label noise attenuates measured
 * performance toward the null — so it is a candidate explanation for protocol 1's
 * failure that cannot be told apart from "no signal" or "low power".
 *
 * The fix is to stop inferring. The bracket says who actually qualified, so
 * protocol 3 observes it instead. This script archives that observation so the
 * result reproduces without re-fetching.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ACQUISITION ONLY — computes no metric.
 *
 *   npx tsx scripts/acquire-mfl-brackets.ts
 *
 * Resumable: leagues already archived are skipped.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DATA_DIR = "reports/2026-08-20/holdout-data";
const STORE = join(DATA_DIR, "_brackets.json");
const BUNDLE = "reports/2026-08-20/holdout-brackets.json.gz";
const UA = "RAE-audit/1.0 (model validation research; contact jviola1@vols.utk.edu)";
const THROTTLE_MS = 1800;

/** Same widened pattern the validator uses — see its comment on "Tiolet Bowl". */
const CONSOLATION = /consolation|toilet|tiolet|loser|place|3rd|5th|7th|shit|sacko|punish/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function readJsonOrNull<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function mfl(season: string, query: string): Promise<any | null> {
  if (!/^[0-9]{4}$/.test(season)) return null;
  const url = `https://api.myfantasyleague.com/${season}/export?${query}&JSON=1`;
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    await sleep(THROTTLE_MS);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    } catch {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(4000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Every franchise id appearing anywhere in the bracket, across ALL rounds.
 *
 * Traversing every round matters: a top seed with a first-round bye does not
 * appear until round two, so a round-one-only read would drop exactly the
 * strongest teams and invert the label.
 */
function participantsOf(node: any, out = new Set<string>()): Set<string> {
  if (node == null || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === "franchise_id" && typeof v === "string" && /^[0-9]{4}$/.test(v)) out.add(v);
    else if (typeof v === "object") participantsOf(v, out);
  }
  return out;
}

interface BracketRecord {
  bracketId: string;
  /** Inferred field size from `teamsInvolved` — kept for comparison, not used as truth. */
  declaredP: number;
  /** OBSERVED qualifiers. This is the label protocol 3 uses. */
  participants: string[];
  acquiredAt: string;
}

async function main(): Promise<void> {
  const store = readJsonOrNull<Record<string, BracketRecord>>(STORE) ?? {};
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();

  console.log(`acquire-mfl-brackets — ${files.length} leagues, ${Object.keys(store).length} already archived\n`);

  let fetched = 0;
  let noBracket = 0;
  let empty = 0;

  for (const f of files) {
    const key = f.replace(/\.json$/, "");
    if (store[key]) continue;

    const raw = readJsonOrNull<any>(join(DATA_DIR, f));
    if (!raw) continue;

    // Championship bracket = largest NON-consolation bracket.
    const brackets = asArray<any>(raw?.playoffBrackets?.playoffBrackets?.playoffBracket);
    let bestId: string | null = null;
    let declaredP = 0;
    for (const b of brackets) {
      const label = `${b?.name ?? ""} ${b?.bracketWinnerTitle ?? ""}`;
      if (CONSOLATION.test(label)) continue;
      const t = Number(b?.teamsInvolved);
      if (Number.isFinite(t) && t > declaredP) {
        declaredP = t;
        bestId = String(b?.id ?? "");
      }
    }
    if (!bestId || declaredP < 2) {
      noBracket += 1;
      continue;
    }

    const detail = await mfl(raw.season, `TYPE=playoffBracket&L=${raw.leagueId}&BRACKET_ID=${bestId}`);
    fetched += 1;
    const participants = [...participantsOf(detail?.playoffBracket ?? detail)].sort();
    if (participants.length === 0) {
      // No observation available. Recorded as empty rather than skipped, so
      // protocol 3 can EXCLUDE the league explicitly instead of silently
      // falling back to the inferred label it is meant to replace.
      empty += 1;
    }
    store[key] = {
      bracketId: bestId,
      declaredP,
      participants,
      acquiredAt: new Date().toISOString()
    };
    writeFileSync(STORE, JSON.stringify(store, null, 1));

    if (fetched % 20 === 0) {
      console.log(`  fetched ${fetched} (archived ${Object.keys(store).length}, empty ${empty})`);
    }
  }

  // Committable artifact so protocol 3 reproduces from a clean checkout.
  const gz = gzipSync(Buffer.from(JSON.stringify(store), "utf8"), { level: 9 });
  writeFileSync(BUNDLE, gz);

  const withParticipants = Object.values(store).filter((b) => b.participants.length > 0);
  const matchesDeclared = withParticipants.filter((b) => b.participants.length === b.declaredP).length;

  console.log(`\n--- summary ---`);
  console.log(`leagues archived        : ${Object.keys(store).length}`);
  console.log(`with observed qualifiers: ${withParticipants.length}`);
  console.log(`empty (no observation)  : ${empty}`);
  console.log(`no usable bracket       : ${noBracket}`);
  console.log(`participants == declared: ${matchesDeclared} / ${withParticipants.length}`);
  console.log(`bundle                  : ${BUNDLE} (${(gz.length / 1e6).toFixed(2)} MB)`);
  console.log(`\nNo metric was computed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
