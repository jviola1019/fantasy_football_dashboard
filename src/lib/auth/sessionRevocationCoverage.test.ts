import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY PROTECTED READ MUST GO THROUGH `requireUser()`.
 *
 * `src/app/page.tsx` carries this comment:
 *
 *     // requireUser(), not a bare auth(): a revoked or deleted-account token is
 *     // still a well-formed JWT ... This was the last raw session read in the
 *     // app (audit F-004).
 *
 * It was not the last one. `src/lib/envelope/load.ts:86` did `await auth()` and
 * took `session.user.id` straight off the token, and that single function is
 * what `(app)/layout.tsx` and all eight route pages call. So the file asserting
 * the invariant was clean and the file feeding the entire authenticated app was
 * not — and nothing could tell, because the claim lived in a comment.
 *
 * What that cost: `changeUserPassword` bumps `sessionVersion` (`users.ts:116`)
 * for one reason — to sign the user out everywhere. `verifySessionUser` is the
 * only thing that reads that column on a request path. A loader that never calls
 * it renders that user's real rosters, projections and league data from a token
 * the password change was supposed to have killed. Same for a deleted account:
 * the row is gone, the JWT is not.
 *
 * A comment cannot enforce an invariant and a hard-coded list of routes cannot
 * notice the next file somebody writes. This scans the tree instead. The
 * allowlist has exactly one entry, and it is the implementation of the rule.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

/**
 * The one file allowed to call `auth()` and inspect the session directly: it is
 * the choke point, and it hands what it finds to `verifySessionUser` for the
 * database check rather than trusting it.
 */
const ALLOWED = new Set(["src/lib/auth/requireUser.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p.slice(ROOT.length + 1).replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * A raw session read: calling `auth()` and pulling a user off the result.
 *
 * Deliberately matches the CALL plus the FIELD ACCESS rather than the import.
 * `requireUser` imports `auth` legitimately, and a file that imported `auth`
 * without ever reading `session.user` would not be trusting a token claim.
 */
export function findsRawSessionRead(source: string): boolean {
  const callsAuth = /\bawait\s+auth\s*\(\s*\)/.test(source);
  if (!callsAuth) return false;
  // Strip line comments so the prose in this repo — which quotes the defect
  // verbatim in several docblocks — cannot register as a violation.
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\bsession\s*\??\.\s*user\b/.test(code);
}

describe("no route reaches the app on a token claim alone", () => {
  const files = walk(SRC);

  it("scans a real tree, so this cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("src/lib/envelope/load.ts");
    expect(files).toContain("src/lib/auth/requireUser.ts");
  });

  it("finds no raw session read outside the choke point", () => {
    const offenders = files.filter(
      (f) => !ALLOWED.has(f) && findsRawSessionRead(readFileSync(join(ROOT, f), "utf8"))
    );
    expect(
      offenders,
      "these files take a user id off the JWT without asking the database whether " +
        "that token is still valid, so a password change does not sign the user out " +
        "of them:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("the choke point is still the choke point", () => {
    // The allowlist is only safe while its one entry actually does the DB check.
    const src = readFileSync(join(ROOT, "src/lib/auth/requireUser.ts"), "utf8");
    expect(src).toMatch(/verifySessionUser/);
  });

  it("detects the exact defect it was written for — the canary", () => {
    // Verbatim shape of `load.ts:86-87` before the fix. If the detector is ever
    // loosened, this is what breaks.
    expect(
      findsRawSessionRead(`
        const session = await auth();
        const userId = session?.user?.id;
      `)
    ).toBe(true);
    // And the shape it must NOT flag: the choke point's own body, which reads
    // the session only to hand it to the verifier.
    expect(findsRawSessionRead(`const user = await requireUser();`)).toBe(false);
    // A comment quoting the defect is prose, not a violation.
    expect(
      findsRawSessionRead(`
        // do not write: const session = await auth(); session.user.id
        const user = await requireUser();
      `)
    ).toBe(false);
  });
});
