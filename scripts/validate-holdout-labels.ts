/**
 * Validate the holdout OUTCOME LABEL against actual playoff bracket participants.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Both holdout protocols define the outcome as `standings rank <= P`, where P is
 * the largest non-consolation bracket's `teamsInvolved`. Protocol 1 §6 declared a
 * self-check that the observed qualification rate equals P/N — and that check is
 * VACUOUS, because the label is DEFINED from the rank, so the identity holds by
 * construction. The harness says so in its own output, but saying so is not the
 * same as closing it.
 *
 * If P is misread for some league shape, or if a league seeds its bracket by
 * something other than the standings sort used here (divisional winners, a
 * two-half format, a points-based wildcard), then those teams are MISLABELLED —
 * and a mislabelled outcome silently corrupts every metric in both protocols.
 *
 * This script closes it by fetching the actual bracket and comparing the real
 * participants against the derived label.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This changes NO protocol. It validates the data both protocols rest on. A
 * disagreement is a finding to disclose, not a licence to relabel.
 *
 *   npx tsx scripts/validate-holdout-labels.ts [--sample 15]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DATA_DIR = "reports/2026-08-20/holdout-data";
const OUT = "reports/2026-08-20/holdout-label-validation.md";
const UA = "RAE-audit/1.0 (model validation research; contact jviola1@vols.utk.edu)";
const THROTTLE_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Consolation-bracket names to exclude when deriving P.
 *
 * `tiolet` is not a typo here — league 2021-10283 literally names its
 * consolation bracket "Tiolet Bowl", and the original pattern missed it. That
 * league happened to be unharmed (both brackets held 8 teams, so max() was still
 * right), but a MISSPELLED consolation bracket larger than the championship
 * bracket would silently inflate P and mislabel real teams. Widened, and the
 * fragility recorded rather than left as luck.
 */
const CONSOLATION = /consolation|toilet|tiolet|loser|place|3rd|5th|7th|shit|sacko|punish/i;

/**
 * Every value interpolated into an MFL query string must be a bare identifier.
 *
 * League ids and bracket ids reach this script by being read out of a file, so
 * CodeQL flags the flow into `fetch` (js/file-access-to-http). Enforcing a
 * numeric contract at the SINK — rather than trusting each call site — makes the
 * flow safe by construction: nothing that is not digits can reach the URL.
 */
const SAFE_QUERY = /^[A-Za-z_]+=[A-Za-z0-9_]+(&[A-Za-z_]+=[A-Za-z0-9_]+)*$/;

async function mfl(season: string, query: string): Promise<any | null> {
  if (!/^[0-9]{4}$/.test(season)) return null;
  // Reject anything that is not a plain key=value query of identifier chars.
  // A league id read from disk cannot smuggle a path, host or extra parameter.
  if (!SAFE_QUERY.test(query)) return null;
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

/** Every franchise id appearing anywhere in a bracket's games. */
function participantsOf(bracket: any): Set<string> {
  const out = new Set<string>();
  const walk = (node: any): void => {
    if (node == null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === "franchise_id" || k === "id") && typeof v === "string" && /^[0-9]{4}$/.test(v)) {
        out.add(v);
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(bracket);
  return out;
}

async function main(): Promise<void> {
  const sampleArg = process.argv.indexOf("--sample");
  const sampleSize = sampleArg >= 0 ? Number(process.argv[sampleArg + 1]) : 15;

  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();
  // Deterministic sample: evenly spaced through the sorted list, so it is not
  // the first N (which would all be low league ids from one season).
  const step = Math.max(1, Math.floor(files.length / sampleSize));
  const chosen = files.filter((_, i) => i % step === 0).slice(0, sampleSize);

  const out: string[] = [];
  const say = (s = "") => {
    out.push(s);
    console.log(s);
  };

  say("# Holdout outcome-label validation");
  say();
  say(`**Executed** ${new Date().toISOString()} · ${chosen.length} of ${files.length} archived leagues`);
  say();
  say(
    "> Closes the vacuous self-check in protocol 1 §6. The label `standings rank <= P` " +
      "is compared against the **actual franchises that appear in the playoff bracket**. " +
      "This changes no protocol; a disagreement is a finding to disclose, not a licence " +
      "to relabel."
  );
  say();
  say("| league | N | P | bracket participants | label agrees? | notes |");
  say("|---|---|---|---|---|---|");

  let checked = 0;
  let agreed = 0;
  let unvalidatable = 0;
  const disagreements: string[] = [];
  const mislabelled = new Set<string>();

  for (const f of chosen) {
    const raw = JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"));
    const L = raw?.league?.league;
    if (!L) continue;
    const franchises = asArray<any>(L?.franchises?.franchise).map((x) => String(x?.id ?? ""));
    const n = franchises.length;

    // Same P derivation the harnesses use.
    const brackets = asArray<any>(raw?.playoffBrackets?.playoffBrackets?.playoffBracket);
    let bestId: string | null = null;
    let p = 0;
    for (const b of brackets) {
      const label = `${b?.name ?? ""} ${b?.bracketWinnerTitle ?? ""}`;
      if (CONSOLATION.test(label)) continue;
      const t = Number(b?.teamsInvolved);
      if (Number.isFinite(t) && t > p) {
        p = t;
        bestId = String(b?.id ?? "");
      }
    }
    if (!bestId || p < 2 || p >= n) continue;

    // Same standings sort the harnesses use.
    const rows = asArray<any>(raw?.leagueStandings?.leagueStandings?.franchise)
      .map((x) => ({ id: String(x?.id ?? ""), w: Number(x?.h2hw), pf: Number(x?.pf) }))
      .filter((x) => x.id && Number.isFinite(x.w) && Number.isFinite(x.pf));
    if (rows.length !== n) continue;
    rows.sort((a, b) => b.w - a.w || b.pf - a.pf);
    const derived = new Set(rows.slice(0, p).map((r) => r.id));

    const detail = await mfl(raw.season, `TYPE=playoffBracket&L=${raw.leagueId}&BRACKET_ID=${bestId}`);
    if (!detail) {
      say(`| ${raw.season}-${raw.leagueId} | ${n} | ${p} | (fetch failed) | — | bracket detail unavailable |`);
      continue;
    }
    const actual = participantsOf(detail?.playoffBracket ?? detail);

    // A bracket with NO extractable franchise ids cannot be judged either way —
    // an unplayed bracket, or a payload shape this parser does not handle.
    // Counting that as a DISAGREEMENT would inflate the error rate with parser
    // failures, which the first version of this script did: it reported 4
    // disagreements when 2 of them were simply unjudgeable.
    if (actual.size === 0) {
      unvalidatable += 1;
      say(`| ${raw.season}-${raw.leagueId} | ${n} | ${p} | 0 | — | no franchise ids in bracket; cannot judge |`);
      continue;
    }

    // A bracket lists only the teams that PLAY in it; byes may not appear in
    // round one, so the real test is that the bracket's participants are a
    // SUBSET of the derived qualifiers, not set equality.
    const missing = [...actual].filter((id) => !derived.has(id));
    const ok = missing.length === 0;

    checked += 1;
    if (ok) agreed += 1;
    else {
      disagreements.push(`${raw.season}-${raw.leagueId}: bracket has ${missing.join(",")} outside the derived top-${p}`);
      mislabelled.add(`${raw.season}-${raw.leagueId}`);
    }

    say(
      `| ${raw.season}-${raw.leagueId} | ${n} | ${p} | ${actual.size} | ${ok ? "**yes**" : "**NO**"} | ` +
        `${ok ? "" : `bracket teams not in derived top-${p}: ${missing.join(", ")}`} |`
    );
  }

  say();
  say("## Result");
  say();
  if (checked === 0) {
    say("No league could be validated — bracket detail was unavailable for the whole sample.");
  } else {
    const rate = agreed / checked;
    say(`**${agreed} of ${checked} judgeable leagues agree** (${(rate * 100).toFixed(1)}%).`);
    say();
    say(
      `${unvalidatable} further league(s) had no franchise ids in their bracket and are ` +
        "counted **neither way** — they are parser/data gaps, not disagreements."
    );
    say();
    if (disagreements.length === 0) {
      say(
        "Every fetched bracket's participants are a subset of the derived top-P by " +
          "standings. The outcome label used by both holdout protocols is **supported by " +
          "the actual brackets**, and protocol 1 §6's vacuous self-check is now closed by " +
          "an external one."
      );
    } else {
      say("**Disagreements found — this is a finding, and both protocols' results inherit it:**");
      say();
      for (const d of disagreements) say(`- ${d}`);
      say();
      say(
        "A bracket containing a team outside the derived top-P means the league seeds " +
          "by something other than the (wins, points-for) sort assumed here — divisional " +
          "winners, a two-half format, or a points-based wildcard. Those teams are " +
          "mislabelled, and the affected leagues should be excluded in any FUTURE " +
          "protocol. They are NOT retro-excluded from a protocol already executed."
      );
    }
  }
  say();
  say(
    "Note on the test: a bracket lists only teams that actually play in it, and a " +
      "top seed with a first-round bye may not appear. So the check is that bracket " +
      "participants are a **subset** of the derived qualifiers, not set equality — " +
      "equality would fail on byes for reasons that are not errors."
  );

  if (mislabelled.size > 0) {
    say();
    say("### Machine-readable exclusion list");
    say();
    say("```json");
    say(JSON.stringify([...mislabelled].sort(), null, 1));
    say("```");
    writeFileSync(
      "reports/2026-08-20/holdout-mislabelled.json",
      JSON.stringify([...mislabelled].sort(), null, 1)
    );
  }

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
