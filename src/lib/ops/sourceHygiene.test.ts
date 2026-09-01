import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Stray C0 control bytes in source, which have now broken a guard twice.
 *
 * A regex written as `\b` — backslash, letter b — is a word boundary. The same
 * two visible characters, typed as one 0x08 byte, are a BACKSPACE, and a regex
 * containing one requires a literal backspace in the subject. It can never
 * match. It also looks completely normal in every editor and every diff.
 *
 * The history in this repository:
 *
 *  1. `e2e/20-model-failure-disclosure.spec.ts` shipped with `/\b(arbitrage…/`
 *     where the `\b` was a backspace byte. The test passed vacuously from the
 *     commit that introduced it — the very commit whose message claimed the
 *     product had stopped asserting arbitrage. Repaired 2026-08-22.
 *  2. `src/lib/models/edgeDisclosure.test.ts` acquired the identical defect on
 *     2026-08-26, in a negation guard, while widening the FIRST guard. Caught
 *     only because the assertion happened to fail loudly that time. It could
 *     just as easily have failed silently open, like its predecessor.
 *
 * Twice is a pattern, and the failure mode is invisible on inspection, so it
 * gets a mechanical check rather than more care.
 *
 * SCOPE: source we author. Tab, newline and carriage return are legitimate;
 * every other C0 control byte, and the C1 DEL, is not.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src", "scripts", "e2e"];
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".css"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "coverage"]);

/** Tab (0x09), LF (0x0A), CR (0x0D) are legitimate whitespace. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
function isForbidden(code: number): boolean {
  if (ALLOWED.has(code)) return false;
  return code < 0x20 || code === 0x7f;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

describe("source hygiene", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("scans a plausible number of files, so a broken walk cannot pass vacuously", () => {
    // The check above is a search for absence. Without this, a walk that
    // returned nothing would report a clean bill of health — which is the same
    // shape of bug it exists to catch.
    expect(files.length).toBeGreaterThan(200);
  });

  it("contains no stray control bytes", () => {
    const offences: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (!isForbidden(code)) continue;
        const line = text.slice(0, i).split("\n").length;
        offences.push(
          `${relative(ROOT, file)}:${line} contains U+${code.toString(16).padStart(4, "0").toUpperCase()}`
        );
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("detects the byte it is looking for", () => {
    // Canary: prove the predicate is live rather than trivially true.
    //
    // The bytes are built with String.fromCharCode rather than typed as
    // literals, because this file is inside the tree the check above scans —
    // a literal backspace here would make the suite fail on its own canary.
    const BACKSPACE = 8;
    const ESCAPE = 27;
    const DEL = 127;
    expect(isForbidden(BACKSPACE), "backspace must be forbidden").toBe(true);
    expect(isForbidden(ESCAPE), "escape must be forbidden").toBe(true);
    expect(isForbidden(DEL), "DEL must be forbidden").toBe(true);
    const TAB = 9;
    const LF = 10;
    const CR = 13;
    expect(isForbidden(TAB), "tab must be allowed").toBe(false);
    expect(isForbidden(LF), "newline must be allowed").toBe(false);
    expect(isForbidden(CR), "carriage return must be allowed").toBe(false);
    expect(isForbidden("a".charCodeAt(0)), "letters must be allowed").toBe(false);

    // And prove the SCAN would flag it, not just the predicate: the two real
    // defects were regexes, so exercise that shape.
    const poisoned = `/${String.fromCharCode(BACKSPACE)}(arbitrage)/i`;
    expect(
      [...poisoned].some((ch) => isForbidden(ch.charCodeAt(0))),
      "a regex carrying a backspace byte must be detected"
    ).toBe(true);
  });
});
