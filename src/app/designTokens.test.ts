import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchets for the token systems that have no static guard yet.
 *
 * `typeScale.test.ts` bans raw `font-size` outright, and it can, because the
 * type system was driven to zero raw sizes before the ban went in. Spacing,
 * tracking and colour are not there yet — measured 2026-08-28:
 *
 *   - 166 off-scale px values across 303 spacing declarations (55%)
 *   - 14 unitless `letterSpacing:` in style objects
 *   - 86 colour literals in .tsx/.ts outside `src/lib/theme.ts`
 *
 * An outright ban would fail the build today, and "fix 266 declarations" is not
 * a change anyone can review. So these are RATCHETS: the current count is
 * recorded, and the suite fails if it grows. Session 2 of the redesign drives
 * them down and tightens each baseline as it goes; when one reaches zero it
 * should be converted to an outright ban like `typeScale.test.ts`.
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

  it("detects an off-scale value", () => {
    // Canary: the matcher must actually reject something.
    expect(SPACE_SCALE.has(14)).toBe(false);
    expect(SPACE_SCALE.has(16)).toBe(true);
  });
});

describe("tracking ratchet", () => {
  // Measured 2026-08-28. These are not broken — React appends `px` to a
  // unitless number, so `letterSpacing: 0.4` is 0.4px, which is close to the
  // `.04em` the stylesheet uses at these sizes. The problem is that they are
  // FIXED where the CSS is RELATIVE: 0.4px stays 0.4px when the type scales up,
  // so the two systems drift apart precisely on the headings a redesign moves.
  const BASELINE = 14;

  function unitlessTracking(): string[] {
    const found: string[] = [];
    for (const f of FILES) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/letterSpacing:\s*([0-9.]+)\s*[,}]/g)) {
        found.push(`${f.slice(srcRoot.length).replace(/\\/g, "/")} = ${m[1]}`);
      }
    }
    return found;
  }

  it("does not grow", () => {
    const found = unitlessTracking();
    expect(
      found.length,
      `unitless letterSpacing went from ${BASELINE} to ${found.length}. ` +
        `Use an em value so tracking scales with type:\n${found.join("\n")}`
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("has a baseline that is actually current", () => {
    expect(BASELINE - unitlessTracking().length).toBeLessThanOrEqual(3);
  });
});

describe("colour-literal ratchet", () => {
  // Measured 2026-08-28. `src/lib/theme.ts` is the sanctioned home for literals
  // — SVG presentation attributes cannot resolve `var()`, which is the whole
  // reason THEME exists — and `theme.test.ts` already fails the build if THEME
  // drifts from the stylesheet. `uiAudit.ts` is exempt for the same reason: a
  // checker comparing against a colour needs that colour as a literal.
  const BASELINE = 86;
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
