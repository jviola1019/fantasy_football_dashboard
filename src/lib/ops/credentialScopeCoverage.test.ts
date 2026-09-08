import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO PRODUCTION CODE READS ESPN COOKIES BY LEAGUE ID ALONE.
 *
 * `getLeagueCredentials(db, leagueId)` is the raw accessor for the per-league
 * OVERRIDE row. It takes no user id, so it cannot check ownership, and it
 * returns decrypted `espn_s2` / `SWID`. It exists because the credential tests
 * need to assert on that row directly — "nothing was stored per league" is only
 * checkable by looking.
 *
 * Two production files called it anyway, and each was two defects at once:
 *
 *   1. **Wrong answer.** The override row is for somebody whose leagues sit
 *      under two different ESPN logins. The normal case is the ACCOUNT pair. So
 *      an ESPN league authenticated by the Settings → Account sign-in resolved
 *      to `null` and returned zero graded trades — silently, with a 200.
 *   2. **No ownership check in the query.** Safe only because both happened to
 *      run `getLeagueForUser` first.
 *
 * `resolveEspnCredentials(db, userId, leagueId)` answers both: override first,
 * then account, and its override branch now joins `leagues` on `userId` so a
 * foreign league id selects no row.
 *
 * The rule is therefore structural: outside `leagues.ts` and its tests, nothing
 * calls the raw accessor. A list of known-bad files would not notice the third
 * one somebody writes.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

/** The accessor's own home, and the tests whose job is to inspect that row. */
const ALLOWED = (path: string): boolean =>
  path === "src/lib/leagues.ts" || /\.test\.tsx?$/.test(path);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p.slice(ROOT.length + 1).replace(/\\/g, "/"));
  }
  return out;
}

/** A CALL, not a mention: the fixed files still name it in their comments. */
export function callsRawAccessor(source: string): boolean {
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\bgetLeagueCredentials\s*\(/.test(code);
}

describe("ESPN cookies are never resolved without a user id", () => {
  const files = walk(SRC);

  it("scans a real tree, so this cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("src/lib/leagues.ts");
    expect(files).toContain("src/app/trade/actions.ts");
  });

  it("finds no production caller of the unscoped accessor", () => {
    const offenders = files.filter((f) => !ALLOWED(f) && callsRawAccessor(readFileSync(join(ROOT, f), "utf8")));
    expect(
      offenders,
      "these read decrypted ESPN cookies by leagueId alone — use " +
        "resolveEspnCredentials(db, userId, leagueId), which checks ownership in " +
        "the query and falls back to the account pair:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("the scoped resolver actually scopes — the query, not the caller", () => {
    // The allowlist above is only safe while `leagues.ts` keeps the join. If the
    // innerJoin is removed, `resolveEspnCredentials` silently becomes the very
    // thing this gate exists to ban, and every caller keeps compiling.
    const src = readFileSync(join(ROOT, "src/lib/leagues.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function resolveEspnCredentials"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/innerJoin\(\s*schema\.leagues/);
    expect(body).toMatch(/eq\(schema\.leagues\.userId,\s*userId\)/);
  });

  it("distinguishes a call from a mention — the canary", () => {
    expect(callsRawAccessor("const c = await getLeagueCredentials(db, id);")).toBe(true);
    // Both fixed files explain themselves by naming the function they no longer
    // call. Prose must not register, or the gate becomes unfixable.
    expect(callsRawAccessor("// resolveEspnCredentials, not getLeagueCredentials(...)")).toBe(false);
    expect(callsRawAccessor("/* see getLeagueCredentials() for the raw row */")).toBe(false);
  });
});
