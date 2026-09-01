import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The README is a claim about the code, so it is checked like one.
 *
 * `readmeScripts.test.ts` already pins the npm-script list, and its own header
 * records why: a prose count ("all 20 are listed") decayed silently and was
 * still there at forty-two scripts. This file generalises that idea to the two
 * other things the README asserts about the repository — that a path exists,
 * and that a symbol exists.
 *
 * WHAT IT CAUGHT ON THE FIRST RUN (2026-09-01)
 *
 * The "Known limitations" entry for the FAAB-depleted lifecycle rule described
 * `fetchLeagueLive` as surfacing `myFaabRemainingRatio`, extracted by
 * `extractSleeperFaabRatio` from "`settings.waiver_budget` −
 * `rosters[i].settings.waiver_budget_used`".
 *
 * All three symbols had been gone since S4, and the sentence was worse than
 * merely stale: `waiver_budget` alone is EXACTLY the detection S4 removed,
 * because Sleeper emits `waiver_budget: 100` for every league whether or not a
 * dollar can be bid — so the README documented, as current behaviour, the
 * fabrication the code had been changed to prevent. A reader had no way to know
 * from reading it, which is the same property that makes a frozen coefficient
 * or a provenance string dangerous.
 *
 * WHY THESE TWO SHAPES, AND NOT "CHECK THE PROSE"
 *
 * Whether an explanation is still TRUE needs a human. Whether the thing it
 * names still EXISTS does not, and that is where the rot starts — a file moves
 * or a function is renamed, and the paragraph around it keeps its confident
 * tone while its referents evaporate. Only the mechanical half is mechanised
 * here.
 */

const ROOT = join(__dirname, "..", "..", "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

/** Inline code spans, with fenced blocks removed — those are shell, not references. */
function inlineCodeSpans(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, "\n");
  return [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
}

const SPANS = inlineCodeSpans(README);

describe("every repository path the README names exists", () => {
  /**
   * Paths the README names *because they are gone*. Each is a deliberate record
   * of a deletion, not a live reference, and removing the sentence would delete
   * the reason the thing is missing.
   */
  const DELIBERATELY_ABSENT: Record<string, string> = {
    "src/lib/weather/":
      "deleted 2026-08-24 (commit 29e6744); the README documents the removal of the open-meteo feed"
  };

  const ROOTED = /^(?:src|docs|e2e|scripts|reports|prisma|public|\.github)\//;

  function namedPaths(): string[] {
    return [...new Set(SPANS.filter((s) => ROOTED.test(s)))];
  }

  /** A glob resolves to its directory: `src/lib/draft/*.test.ts` → `src/lib/draft`. */
  function resolvable(p: string): string {
    const cut = p.replace(/[:#].*$/, "");
    const star = cut.indexOf("*");
    return star === -1 ? cut : cut.slice(0, cut.lastIndexOf("/", star));
  }

  it("finds paths to check, so a broken scan cannot pass vacuously", () => {
    expect(namedPaths().length).toBeGreaterThan(30);
  });

  it("names no path that is missing without saying why", () => {
    const missing = namedPaths().filter(
      (p) => !(p in DELIBERATELY_ABSENT) && !existsSync(join(ROOT, resolvable(p)))
    );
    expect(
      missing,
      `the README points at these paths and they do not exist:\n${missing.join("\n")}\n` +
        `Either fix the reference, or add it to DELIBERATELY_ABSENT with the reason it is named.`
    ).toEqual([]);
  });

  it("keeps the exemption list honest — an exemption for a path that came back is stale", () => {
    // The opposite rot: `src/lib/weather/` is restored from git history one day
    // and the exemption goes on asserting it is gone.
    const resurrected = Object.keys(DELIBERATELY_ABSENT).filter((p) =>
      existsSync(join(ROOT, resolvable(p)))
    );
    expect(resurrected, `these are exempted as deleted but exist: ${resurrected.join(", ")}`).toEqual(
      []
    );
  });

  it("detects a path that does not exist", () => {
    // Canary. A checker that resolves everything is indistinguishable from one
    // whose regex has stopped matching.
    expect(existsSync(join(ROOT, "src/lib/definitely-not-here"))).toBe(false);
    expect(ROOTED.test("src/lib/leagues/faab.ts")).toBe(true);
    expect(ROOTED.test("npm run build")).toBe(false);
  });
});

describe("every RAE symbol the README names exists in the code", () => {
  /**
   * Names that are camelCase but belong to somebody else's API, so the code
   * touches them as strings or as fields on a foreign object rather than
   * declaring them. Each is listed with the source that owns it.
   */
  const FOREIGN: Record<string, string> = {
    mSettings: "ESPN Fantasy API `?view=` parameter",
    viewBox: "SVG attribute",
    acquisitionBudget: "ESPN Fantasy API field under settings.acquisitionSettings"
  };

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
   * reported the README as current. A symbol that survives only in prose about
   * its own removal is exactly the case this test exists to fail.
   */
  function codeWithoutComments(): string {
    let out = "";
    for (const f of sourceFiles(join(ROOT, "src")).concat(sourceFiles(join(ROOT, "scripts")))) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*")) continue;
        out += `${line}\n`;
      }
    }
    return out;
  }

  const CODE = codeWithoutComments();

  /** Lowercase-initial with an interior capital: `fetchLeagueLive`, not `postgres`. */
  const CAMEL = /^[a-z][A-Za-z0-9]*$/;
  function namedSymbols(): string[] {
    return [
      ...new Set(SPANS.filter((s) => CAMEL.test(s) && /[A-Z]/.test(s) && s.length >= 4))
    ];
  }

  it("finds symbols to check, so a broken scan cannot pass vacuously", () => {
    expect(namedSymbols().length).toBeGreaterThan(10);
    expect(CODE.length).toBeGreaterThan(500_000);
  });

  it("names no symbol that the code no longer contains", () => {
    const missing = namedSymbols().filter((s) => !(s in FOREIGN) && !CODE.includes(s));
    expect(
      missing,
      `the README names these and the code does not contain them:\n${missing.join("\n")}\n` +
        `Either fix the reference, or add it to FOREIGN with the API that owns it.`
    ).toEqual([]);
  });

  it("keeps FOREIGN from becoming a silent allow-list", () => {
    // An entry that the README stopped mentioning is dead weight that hides
    // whether the exemption was ever needed.
    const unused = Object.keys(FOREIGN).filter((s) => !namedSymbols().includes(s));
    expect(unused, `exempted but no longer named in the README: ${unused.join(", ")}`).toEqual([]);
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
