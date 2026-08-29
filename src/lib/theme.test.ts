import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME, OUTCOME_COLORS, withAlpha } from "./theme";

/**
 * The JS palette and the CSS palette must be the same palette.
 *
 * Design audit 2026-08-22, D-5. SVG presentation attributes cannot resolve
 * `var()`, so every chart hard-coded hex values — and a whole PRE-REPAINT
 * palette survived in them long after the tokens moved. The charts were painted
 * in the colours of a design that no longer existed, and nothing could detect
 * it: a colour regression is invisible to typecheck, lint, axe and Playwright
 * alike, which is exactly why this finding was deferred rather than eyeballed.
 *
 * This file is the detector. Without it, `theme.ts` is just a second place for
 * the palette to drift.
 */
const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");
const CSS_LINES = css.split(String.fromCharCode(10));

function cssToken(name: string): string | null {
  const line = CSS_LINES.find((l) => l.trim().startsWith(`--${name}:`));
  if (!line) return null;
  const m = /#[0-9a-fA-F]{3,8}/.exec(line);
  return m ? m[0].toLowerCase() : null;
}

/** JS constant → the CSS custom property it must equal. */
const PAIRS: Array<[keyof typeof THEME, string]> = [
  ["bg", "bg"],
  ["panel", "panel"],
  ["panel2", "panel-2"],
  ["cream", "cream"],
  ["muted", "muted"],
  ["amber", "amber"],
  ["green", "green"],
  ["teal", "teal"],
  ["red", "red"],
  ["blue", "blue"],
  ["purple", "purple"],
  ["govText", "gov-text"],
  ["labelText", "label-text"]
];

describe("the JS palette matches the CSS palette", () => {
  it.each(PAIRS)("THEME.%s equals --%s", (jsKey, cssName) => {
    const fromCss = cssToken(cssName);
    expect(fromCss, `--${cssName} must be declared in globals.css`).not.toBeNull();
    expect(THEME[jsKey].toLowerCase()).toBe(fromCss);
  });

  it("covers every colour token declared in :root", () => {
    // A token added to CSS and not mirrored here is how the drift started.
    // This lists the exceptions explicitly rather than silently ignoring them.
    const declared = CSS_LINES.map((l) => /^\s*--([a-z0-9-]+):\s*#[0-9a-fA-F]{3,8};/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!);
    const mirrored = new Set(PAIRS.map(([, cssName]) => cssName));
    const knownUnmirrored = new Set([
      // Position accents — used only by CSS badges, never by a chart attribute.
      "pos-qb",
      "pos-rb",
      "pos-wr",
      "pos-te",
      // Contrast-tuned variants for specific tinted grounds; see globals.css.
      "notice-red",
      "band-extreme",
      // A CSS-only alias of --amber, kept so governance surfaces can be
      // re-themed independently of the action colour.
      "accent-warm",
      // shadcn's @theme namespace, derived from the tokens above.
      ...declared.filter((t) => t.startsWith("color-"))
    ]);
    const missing = declared.filter((t) => !mirrored.has(t) && !knownUnmirrored.has(t));
    expect(missing, `these CSS colour tokens have no JS mirror: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("the outcome palette is drawn from the theme, not invented", () => {
  it("uses only theme colours", () => {
    const themeValues = new Set(Object.values(THEME));
    for (const [bucket, color] of Object.entries(OUTCOME_COLORS)) {
      expect(themeValues.has(color as (typeof THEME)[keyof typeof THEME]), `${bucket} = ${color}`).toBe(true);
    }
  });

  it("gives every bucket a distinct colour", () => {
    // Two buckets sharing a hue would make the chart unreadable without labels.
    const values = Object.values(OUTCOME_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("no component hard-codes a retired colour", () => {
  const componentsRoot = fileURLToPath(new URL("../components", import.meta.url));

  /** The pre-repaint palette. Any reappearance is the D-5 regression. */
  const RETIRED = ["#77d7b0", "#d9866f", "#f5c566", "#eaa53d", "#4a8cf7", "#8d9aa0", "#7bb7ce"];

  function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) tsxFiles(p, out);
      else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  it("finds component files at all", () => {
    // Guards the scan itself: a wrong path would make the assertion below pass
    // without checking anything.
    expect(tsxFiles(componentsRoot).length).toBeGreaterThan(20);
  });

  it.each(RETIRED)("%s appears in no component", (hex) => {
    const offenders = tsxFiles(componentsRoot).filter((f) =>
      readFileSync(f, "utf8").toLowerCase().includes(hex)
    );
    expect(offenders).toEqual([]);
  });
});

describe("withAlpha", () => {
  it("converts a palette hex to rgba", () => {
    expect(withAlpha(THEME.teal, 0.18)).toBe("rgba(47, 182, 196, 0.18)");
    expect(withAlpha(THEME.amber, 1)).toBe("rgba(215, 168, 87, 1)");
  });

  it("clamps alpha rather than emitting an invalid colour", () => {
    expect(withAlpha(THEME.blue, 2)).toContain(", 1)");
    expect(withAlpha(THEME.blue, -1)).toContain(", 0)");
  });

  it("refuses anything that is not a palette hex", () => {
    // The point is that an alpha variant cannot drift from its solid. Accepting
    // a shorthand or a bare name would let a caller pass something THEME does
    // not contain — which is exactly how #4dd9c0 survived in RadarChart.
    for (const bad of ["#fff", "teal", "rgb(1,2,3)", "", "#12345"]) {
      expect(() => withAlpha(bad, 0.5)).toThrow();
    }
  });

  it("round-trips every THEME colour", () => {
    for (const [name, hex] of Object.entries(THEME)) {
      expect(withAlpha(hex, 0.5), `THEME.${name}`).toMatch(/^rgba\(\d+, \d+, \d+, 0\.5\)$/);
    }
  });
});
