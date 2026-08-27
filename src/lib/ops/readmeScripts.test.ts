import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `package.json` script must be documented in the README.
 *
 * The README's "Exact run commands" section has been wrong twice. It first
 * listed nine scripts of the twenty that existed, which the 2026-08-20 audit
 * caught with the note that "the security gates and model harnesses were
 * effectively undiscoverable". The repair added the missing eleven and asserted
 * "All 20 are listed" — and that sentence was still there on 2026-08-26 with
 * forty-two scripts in the file, twenty of them unmentioned. Among the missing
 * were `audit:reachability`, `verify:inseason`, and the generator of
 * `docs/brier-results.md` itself, which had no npm script at all.
 *
 * A prose count is a claim that decays silently on the next commit. This test
 * is the same claim in a form that cannot: add a script without documenting it
 * and the suite fails.
 *
 * It deliberately checks only PRESENCE. What each script does, and how the
 * sections are grouped, stays a human judgement — mechanising that would just
 * produce a generated list nobody reads.
 */

const ROOT = join(__dirname, "..", "..", "..");

describe("README documents every npm script", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const names = Object.keys(pkg.scripts);

  it("finds the scripts at all, so a broken read cannot pass vacuously", () => {
    // Without this, an empty `scripts` object would make the check below
    // trivially true — the same shape of bug the check exists to catch.
    expect(names.length).toBeGreaterThan(20);
    expect(readme.length).toBeGreaterThan(10_000);
  });

  it("mentions every script by name", () => {
    // `npm run <name>` is the form the README uses throughout. Matching that
    // exact form, rather than a bare substring, stops `test` from being
    // "documented" by the word test appearing somewhere in a paragraph.
    const mentioned = new Set(
      [...readme.matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => m[1] as string)
    );
    const undocumented = names.filter((n) => !mentioned.has(n));
    expect(
      undocumented,
      `these scripts exist but the README never names them: ${undocumented.join(", ")}`
    ).toEqual([]);
  });

  it("does not document scripts that no longer exist", () => {
    // The opposite rot: a script is deleted and the README goes on advertising
    // a command that now fails with "missing script".
    const declared = new Set(names);
    const mentioned = [...readme.matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => m[1] as string);
    const phantom = [...new Set(mentioned)].filter((n) => !declared.has(n));
    expect(
      phantom,
      `the README documents commands that do not exist: ${phantom.join(", ")}`
    ).toEqual([]);
  });

  it("every script has a runnable file behind it", () => {
    // A third rot: the script survives, the file it points at does not.
    const missing: string[] = [];
    for (const [name, command] of Object.entries(pkg.scripts)) {
      const match = /(?:tsx|node)\s+(scripts\/[\w.-]+\.(?:ts|mjs|js))/.exec(command);
      if (!match) continue;
      try {
        readFileSync(join(ROOT, match[1] as string), "utf8");
      } catch {
        missing.push(`${name} -> ${match[1]}`);
      }
    }
    expect(missing, `scripts pointing at files that do not exist: ${missing.join(", ")}`).toEqual(
      []
    );
  });
});
