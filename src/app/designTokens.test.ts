import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchets for the token systems that have no static guard yet.
 *
 * `typeScale.test.ts` bans raw `font-size` outright, and it can, because the
 * type system was driven to zero raw sizes before the ban went in. Spacing and
 * colour are not there yet. Measured at the start of session 1, and again after
 * session 2:
 *
 *   | system   | s1  | s2  | status                                   |
 *   |----------|-----|-----|------------------------------------------|
 *   | spacing  | 166 | 166 | ratchet — deliberately untouched, see below |
 *   | tracking |  14 |   0 | **now a ban**                            |
 *   | colour   |  86 |  84 | ratchet                                  |
 *
 * An outright ban on all three would have failed the build on day one, and "fix
 * 266 declarations" is not a change anyone can review. So they start as
 * RATCHETS: the count is recorded and the suite fails if it grows. When one
 * reaches zero it graduates to a ban, which is what tracking just did.
 *
 * A ratchet is weaker than a ban and stronger than nothing. What it buys is
 * that a redesign touching hundreds of declarations cannot quietly make the
 * problem worse while appearing to make it better.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(`${here}globals.css`, "utf8");

/** The scale declared in `globals.css` and mirrored in `uiAudit.ts`. */
const SPACE_SCALE = new Set([0, 4, 8, 12, 16, 24, 32, 48]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(srcRoot);

describe("spacing ratchet", () => {
  // Measured 2026-08-28. Dominated by 6px (x62), 2px (x31), 10px (x20),
  // 3px (x19), 5px (x14) — hairline offsets and optical nudges that predate the
  // scale, not deliberate exceptions to it.
  const BASELINE = 166;

  function offScaleCount(): number {
    const props = String.raw`(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?`;
    const decls = css.match(new RegExp(String.raw`\b${props}:\s*[^;]+;`, "g")) ?? [];
    let n = 0;
    for (const decl of decls) {
      for (const m of decl.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        if (!SPACE_SCALE.has(Math.abs(Number(m[1])))) n += 1;
      }
    }
    return n;
  }

  it("does not grow", () => {
    const n = offScaleCount();
    expect(
      n,
      `off-scale spacing values went from ${BASELINE} to ${n}. The scale is ` +
        `${[...SPACE_SCALE].join("/")}; lower the baseline when you reduce it, never raise it.`
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("has a baseline that is actually current, so the ratchet cannot go slack", () => {
    // A baseline left far above the real count is a ratchet that permits
    // regression silently. Kept within 10 of the truth.
    expect(BASELINE - offScaleCount()).toBeLessThanOrEqual(10);
  });

  it("is unchanged by session 2, deliberately", () => {
    // Session 2 was token hygiene: dead tokens, the sidebar bug, motion wiring,
    // real font weights, tracking units. It did NOT normalise spacing, and that
    // is a scoping decision rather than an oversight.
    //
    // 166 values across 303 declarations are mostly 6px, 2px, 10px, 3px and 5px
    // -- hairline offsets and optical nudges that predate the scale. Snapping
    // them changes padding on nearly every surface in the product, and doing that
    // without looking at the result is how a "cleanup" ships a visual regression.
    // It lands with session 4, where the density work puts the same surfaces
    // under review anyway.
    expect(offScaleCount()).toBe(166);
  });

  it("detects an off-scale value", () => {
    // Canary: the matcher must actually reject something.
    expect(SPACE_SCALE.has(14)).toBe(false);
    expect(SPACE_SCALE.has(16)).toBe(true);
  });
});

describe("tracking — an outright ban, not a ratchet", () => {
  // Reached zero in redesign session 2, so per the policy at the top of this
  // file it graduates from a ratchet to a ban. All 14 became em values, which
  // scale with type; a px value does not, so the two systems drifted apart
  // exactly on the headings a redesign moves.
  it("no style object sets a unitless letterSpacing", () => {
    const found: string[] = [];
    for (const f of FILES) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/letterSpacing:\s*([0-9.]+)\s*[,}]/g)) {
        found.push(`${f.slice(srcRoot.length).replace(/\\/g, "/")} = ${m[1]}`);
      }
    }
    expect(
      found,
      `React appends px to a unitless number, so these do not scale with type. ` +
        `Use an em string:\n${found.join("\n")}`
    ).toEqual([]);
  });

  it("detects the pattern it bans", () => {
    // Canary. A ban that matches nothing is indistinguishable from a clean tree.
    const sample = 'style={{ letterSpacing: 0.4 }}';
    expect([...sample.matchAll(/letterSpacing:\s*([0-9.]+)\s*[,}]/g)].length).toBe(1);
  });
});

describe("colour-literal ratchet", () => {
  // Measured 2026-08-28. `src/lib/theme.ts` is the sanctioned home for literals
  // — SVG presentation attributes cannot resolve `var()`, which is the whole
  // reason THEME exists — and `theme.test.ts` already fails the build if THEME
  // drifts from the stylesheet. `uiAudit.ts` is exempt for the same reason: a
  // checker comparing against a colour needs that colour as a literal.
  // 86 -> 84 in session 2: RadarChart's two off-palette literals became
  // THEME.teal via the new withAlpha helper.
  const BASELINE = 84;
  const EXEMPT = ["lib/theme.ts", "lib/ops/uiAudit.ts"];

  function literals(): string[] {
    const found: string[] = [];
    for (const f of FILES) {
      const rel = f.slice(srcRoot.length).replace(/\\/g, "/");
      if (EXEMPT.some((e) => rel.endsWith(e))) continue;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
        const v = m[0];
        if (v.startsWith("#") && ![4, 7, 9].includes(v.length)) continue;
        found.push(`${rel} = ${v}`);
      }
    }
    return found;
  }

  it("does not grow", () => {
    const found = literals();
    expect(
      found.length,
      `colour literals went from ${BASELINE} to ${found.length}. Prefer a CSS ` +
        `custom property, or THEME when the target is SVG.`
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("has a baseline that is actually current", () => {
    expect(BASELINE - literals().length).toBeLessThanOrEqual(6);
  });

  it("finds the literals it is looking for", () => {
    // Canary: the scan must be live. RadarChart carries an orphan teal that
    // exists in neither THEME nor globals.css — if this returns nothing, the
    // regex has stopped matching.
    expect(literals().length).toBeGreaterThan(20);
  });
});
