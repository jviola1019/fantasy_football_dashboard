import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The documentation is a set of claims about the code, so it is checked like one.
 *
 * `readmeScripts.test.ts` pins the npm-script list, and its header records why:
 * a prose count ("all 20 are listed") decayed silently and was still there at
 * forty-two scripts. This generalises that to the two claims every doc makes
 * that a machine can settle — a path exists, and a symbol exists — across the
 * README and every file in `docs/`.
 *
 * WHAT IT CAUGHT (2026-09-01, first run over each scope)
 *
 * README: the FAAB paragraph named `myFaabRemainingRatio`,
 * `extractSleeperFaabRatio` and `extractEspnFaabRatio`, all deleted in S4, and
 * described FAAB detection keyed on `waiver_budget` alone — which is precisely
 * the fabrication S4 removed, since Sleeper sends `waiver_budget: 100` for every
 * league whether or not a dollar can be bid. The README documented, as current
 * behaviour, the thing the code had been changed to prevent.
 *
 * docs/: `valuationGap` was still called `marketInefficiency` in eight places
 * across two files; `CI_MULTIPLIER`/`CI_LABEL` were documented as widening the
 * simulation's bands 1.5x/2.5x two weeks after audit P0-4 deleted them;
 * `deriveConfidenceBands` and `ConfidenceBands` had been renamed to
 * `deriveReplicationRange` and `ScenarioBands` as part of retracting a "95%
 * confidence interval" claim the model was not entitled to, and the map still
 * carried the old wording; `docs/calibration.md` listed a weather feed deleted
 * on 2026-08-24 as "already wired" and an RSS news adapter that never existed.
 *
 * WHY THESE TWO SHAPES AND NOT "CHECK THE PROSE"
 *
 * Whether an explanation is still TRUE needs a human. Whether the thing it names
 * still EXISTS does not, and that is where the rot starts: a file moves or a
 * function is renamed, the paragraph keeps its confident tone, and its referents
 * quietly evaporate. Only the mechanical half is mechanised here.
 */

const ROOT = join(__dirname, "..", "..", "..");

/** Every doc whose claims are checked. */
function docPaths(): string[] {
  const docs = readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`);
  return ["README.md", ...docs];
}

/** Inline code spans, with fenced blocks removed — those are shell, not references. */
function inlineCodeSpans(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, "\n");
  return [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
}

const SPANS_BY_DOC = new Map<string, string[]>(
  docPaths().map((d) => [d, inlineCodeSpans(readFileSync(join(ROOT, d), "utf8"))])
);

/**
 * Names a doc mentions BECAUSE THEY ARE GONE, or because somebody else owns them.
 *
 * Each entry is a reason, not a mute. A record of a deletion is the most
 * valuable sentence in a doc — it is the only place that says why the thing is
 * missing — so the gate has to be able to tell "documented as removed" from
 * "documented as present", and only a human can. The lists below are audited by
 * their own tests: an exemption for something that comes back, or that the docs
 * stop mentioning, fails as stale.
 */
const EXEMPT: Record<string, string> = {
  // Deleted, and each doc names it in order to record the deletion.
  "src/lib/weather/": "deleted 2026-08-24 (29e6744) — the open-meteo feed was never wired",
  "src/lib/weather/openmeteo.ts": "deleted 2026-08-24 (29e6744), struck through in docs/calibration.md",
  "src/lib/news/": "never existed — docs/calibration.md now says so explicitly",
  CI_MULTIPLIER: "removed by audit P0-4 2026-08-22; data-source-map records the removal",
  CI_LABEL: "removed by audit P0-4 2026-08-22; data-source-map records the removal",
  deriveConfidenceBands: "renamed to deriveReplicationRange; the map records the rename",
  MEDIAN_TV: "removed unit error; simulation.ts keeps it only in the comment explaining it",
  // Owned by somebody else's API or language.
  CURRENT_TIMESTAMP: "SQL keyword",
  mSettings: "ESPN Fantasy API ?view= parameter",
  viewBox: "SVG attribute",
  acquisitionBudget: "ESPN Fantasy API field under settings.acquisitionSettings"
};

const ROOTED = /^(?:src|docs|e2e|scripts|reports|prisma|public|\.github)\//;
/** Lowercase-initial with an interior capital: `fetchLeagueLive`, not `postgres`. */
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
/** A declared constant: `OPPORTUNITY_WEIGHT`. */
const SCREAMING = /^[A-Z][A-Z0-9_]{3,}$/;

/**
 * Expand the shorthands a doc legitimately uses for a set of files.
 *
 *   src/lib/draft/{tiers,recommend}.test.ts  → both members
 *   src/lib/draft/*.test.ts                  → the directory
 *   e2e/23                                   → any file starting `23`
 */
function candidatePaths(p: string): string[] {
  const cut = p.replace(/[:#].*$/, "");
  const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(cut);
  if (brace) return brace[2].split(",").map((part) => `${brace[1]}${part.trim()}${brace[3]}`);
  const star = cut.indexOf("*");
  if (star !== -1) return [cut.slice(0, cut.lastIndexOf("/", star))];
  return [cut];
}

function pathResolves(p: string): boolean {
  return candidatePaths(p).every((c) => {
    if (existsSync(join(ROOT, c))) return true;
    // A numbered prefix like `e2e/23` names a spec by its number.
    const slash = c.lastIndexOf("/");
    if (slash === -1) return false;
    const dir = join(ROOT, c.slice(0, slash));
    const prefix = c.slice(slash + 1);
    if (!prefix || !existsSync(dir)) return false;
    return readdirSync(dir).some((f) => f.startsWith(prefix));
  });
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Comments are stripped before the search, and that is the whole point.
 *
 * `myFaabRemainingRatio` still appears in `fetchLive.ts` — inside the comment
 * explaining that S4 replaced it. Searching raw text would have found it and
 * reported the README as current. A symbol that survives only in prose about its
 * own removal is exactly the case this exists to fail.
 */
const CODE = (() => {
  let out = "";
  for (const root of ["src", "scripts", "e2e"]) {
    for (const f of sourceFiles(join(ROOT, root))) {
      // This file is excluded from its own corpus. Every key in EXEMPT is a
      // string literal on a real code line here, so scanning it would report
      // each removed symbol as "back in the code" — the gate would be reading
      // its own exemption list as evidence against itself.
      if (f.endsWith("docsTruth.test.ts")) continue;
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*")) continue;
        out += `${line}\n`;
      }
    }
  }
  return out;
})();

describe("every repository path the docs name exists", () => {
  it("finds paths to check, so a broken scan cannot pass vacuously", () => {
    const all = [...SPANS_BY_DOC.values()].flat().filter((s) => ROOTED.test(s));
    expect(all.length).toBeGreaterThan(60);
  });

  it.each(docPaths())("%s", (doc) => {
    const named = [...new Set((SPANS_BY_DOC.get(doc) ?? []).filter((s) => ROOTED.test(s)))];
    const missing = named.filter((p) => !(p in EXEMPT) && !pathResolves(p));
    expect(
      missing,
      `${doc} points at these and they do not exist: ${missing.join(", ")}. ` +
        `Fix the reference, or add it to EXEMPT with the reason it is named.`
    ).toEqual([]);
  });

  it("detects a path that does not exist", () => {
    // Canary. A checker that resolves everything is indistinguishable from one
    // whose regex has stopped matching.
    expect(pathResolves("src/lib/definitely-not-here")).toBe(false);
    expect(pathResolves("src/lib/leagues/faab.ts")).toBe(true);
    expect(pathResolves("src/lib/draft/{tiers,recommend}.test.ts")).toBe(true);
    expect(pathResolves("src/lib/draft/{tiers,nope-not-real}.test.ts")).toBe(false);
    expect(ROOTED.test("npm run build")).toBe(false);
  });
});

describe("every RAE symbol the docs name exists in the code", () => {
  function symbols(doc: string): string[] {
    return [
      ...new Set(
        (SPANS_BY_DOC.get(doc) ?? []).filter(
          (s) => (CAMEL.test(s) && /[A-Z]/.test(s) && s.length >= 4) || SCREAMING.test(s)
        )
      )
    ];
  }

  it("finds symbols to check, so a broken scan cannot pass vacuously", () => {
    expect(docPaths().flatMap(symbols).length).toBeGreaterThan(120);
    expect(CODE.length).toBeGreaterThan(500_000);
  });

  it.each(docPaths())("%s", (doc) => {
    const missing = symbols(doc).filter((s) => !(s in EXEMPT) && !CODE.includes(s));
    expect(
      missing,
      `${doc} names these and the code does not contain them: ${missing.join(", ")}. ` +
        `Fix the reference, or add it to EXEMPT with the API that owns it or the ` +
        `removal it records.`
    ).toEqual([]);
  });

  it("would fail on a symbol that lives only in a comment", () => {
    // Canary for the comment stripper, which is the load-bearing part.
    const sample = ["const kept = 1;", "// const removedName = 2;", "/* alsoGoneName */"].join("\n");
    const stripped = sample
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(stripped).toContain("kept");
    expect(stripped).not.toContain("removedName");
    expect(stripped).not.toContain("alsoGoneName");
  });
});

describe("the exemption list stays honest", () => {
  const allSpans = [...SPANS_BY_DOC.values()].flat();

  it("holds nothing the docs have stopped naming", () => {
    // Dead weight hides whether an exemption was ever needed.
    const unused = Object.keys(EXEMPT).filter((k) => !allSpans.includes(k));
    expect(unused, `exempted but no longer named in any doc: ${unused.join(", ")}`).toEqual([]);
  });

  it("holds no path that has come back", () => {
    // `src/lib/weather/` is restored from git history one day and the exemption
    // goes on asserting it is gone.
    const back = Object.keys(EXEMPT).filter((k) => ROOTED.test(k) && pathResolves(k));
    expect(back, `exempted as deleted but present: ${back.join(", ")}`).toEqual([]);
  });

  it("holds no RAE symbol that has come back to the code", () => {
    // Foreign names (an ESPN field, a SQL keyword) are exempt for a different
    // reason and are allowed to appear; removals are not.
    const FOREIGN = new Set(["CURRENT_TIMESTAMP", "mSettings", "viewBox", "acquisitionBudget"]);
    const back = Object.keys(EXEMPT).filter(
      (k) => !ROOTED.test(k) && !FOREIGN.has(k) && CODE.includes(k)
    );
    expect(back, `exempted as removed but present in code: ${back.join(", ")}`).toEqual([]);
  });
});
