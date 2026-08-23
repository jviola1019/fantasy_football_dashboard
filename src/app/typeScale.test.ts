import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: RAE has ONE type scale, and it stays a scale.
 *
 * WHAT WENT WRONG (design audit 2026-08-22, finding D-6)
 *
 * There was no type scale at all. `@theme` defined spacing and radius tokens but
 * nothing for type, so 264 sites set their own size through four unreconciled
 * systems: 156 raw `font-size` declarations in globals.css spanning TWELVE px
 * values (8, 9, 10, 11, 12, 12.5, 13, 14, 18, 20, 24, 32), 42 Tailwind
 * defaults, 14 arbitrary `text-[Npx]` utilities, and 52 inline `fontSize`
 * numbers. 78% of the CSS declarations sat inside the 8–11px band.
 *
 * The consequence was not ugliness, it was illegibility of STRUCTURE: when
 * almost everything is the same size, size stops ranking anything, and the
 * reader has to read every element to find out which one matters. That is why
 * the design audit's verdict on the whole product was "the failure is
 * hierarchy, not honesty" — the governance content was there and correct, and
 * the visual system simply refused to rank it.
 *
 * These tests pin the three properties that make it a scale rather than a pile:
 * the ladder is strictly increasing, the prose floor holds, and no fifth system
 * creeps back in.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(`${here}globals.css`, "utf8");
const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const CSS_LINES = css.split(String.fromCharCode(10));

/** Every .tsx under src/, so a new file cannot quietly reintroduce a raw size. */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (entry.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const SCALE = ["--text-micro", "--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl", "--text-3xl"];

function declaredPx(token: string): number {
  const line = CSS_LINES.find((l) => l.trim().startsWith(`${token}:`));
  const px = line ? /([0-9.]+)px/.exec(line) : null;
  if (!px) throw new Error(`type-scale token ${token} is not declared in globals.css`);
  return Number(px[1]);
}

describe("the type scale exists and is a scale", () => {
  it("declares all eight steps", () => {
    for (const token of SCALE) expect(() => declaredPx(token)).not.toThrow();
  });

  it("is strictly increasing — no two steps may collapse into each other", () => {
    // The original defect was twelve sizes that were not a ladder: 10px and
    // 11px did the same job, so picking between them communicated nothing.
    const sizes = SCALE.map(declaredPx);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i], `${SCALE[i]} must exceed ${SCALE[i - 1]}`).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it("keeps the 11px prose floor from audit 2026-07-08 F-05", () => {
    // Trust-critical text — source, freshness, confidence, failure notes — is
    // what answers "can I trust it?", and it must stay readable on a phone.
    // `--text-micro` is licensed ONLY for uppercase, letter-spaced labels
    // inside dense grids; --text-xs is the floor for anything read as a
    // sentence, and it may never drop below 11px.
    expect(declaredPx("--text-xs")).toBeGreaterThanOrEqual(11);
  });

  it("gives the scale a real top, so a route can have a loudest element", () => {
    // Before this, the largest thing in globals.css was 32px and the largest on
    // a normal route was an 18px panel title — there was no size a page title
    // could occupy that nothing else already used.
    expect(declaredPx("--text-xl")).toBeGreaterThanOrEqual(24);
    expect(declaredPx("--text-xl") / declaredPx("--text-sm")).toBeGreaterThan(1.6);
  });
});

describe("nothing sets type outside the scale", () => {
  it("has no raw px font-size left in globals.css", () => {
    const raw = css.match(/font-size:\s*[0-9.]+px/g) ?? [];
    expect(raw, `raw font-size declarations must use a --text-* token: ${raw.join(", ")}`).toEqual([]);
  });

  it("has no arbitrary text-[Npx] utility in any component", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(srcRoot)) {
      const hits = readFileSync(file, "utf8").match(/text-\[[0-9.]+px\]/g);
      if (hits) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("has no numeric inline fontSize in any component style object", () => {
    // `fontSize: 11` in a style object is invisible to every design review and
    // to every global change — it was the single largest source of drift.
    // SVG `fontSize={9}` PROPS are exempt and deliberately so: they compile to
    // SVG presentation attributes, which cannot resolve a CSS var().
    const offenders: string[] = [];
    for (const file of tsxFiles(srcRoot)) {
      const hits = readFileSync(file, "utf8").match(/fontSize:\s*[0-9.]+/g);
      if (hits) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
