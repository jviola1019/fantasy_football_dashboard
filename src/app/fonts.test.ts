import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard: the editorial font stack must be self-hosted via next/font, never
 * re-introduced as a render-blocking `@import url(fonts.googleapis.com…)` in
 * CSS. The CSS @import forced a blocking round-trip to Google's servers on
 * first paint (an LCP/CLS regression) and added a third-party network
 * dependency to the critical render path. next/font self-hosts at build time
 * with a size-adjusted fallback. This test fails the build if the regression
 * comes back or the variable wiring is dropped.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(`${here}globals.css`, "utf8");
const layout = readFileSync(`${here}layout.tsx`, "utf8");

describe("font loading", () => {
  it("does not load fonts via a render-blocking external @import", () => {
    // The legit imports are quoted package imports (@import "tailwindcss").
    // A regression would re-introduce `@import url(https://fonts…)`.
    expect(css).not.toMatch(/@import\s+url\(/);
    expect(css).not.toMatch(/url\(\s*['"]?https?:\/\/fonts\./i);
  });

  it("loads the editorial families through next/font/google", () => {
    expect(layout).toContain("next/font/google");
    for (const family of ["Bricolage_Grotesque", "IBM_Plex_Sans", "IBM_Plex_Mono"]) {
      expect(layout).toContain(family);
    }
  });

  it("wires each next/font CSS variable into the html element and the stylesheet", () => {
    for (const cssVar of ["--font-bricolage", "--font-plex-sans", "--font-plex-mono"]) {
      // declared on <html> via the next/font `variable` option
      expect(layout).toContain(cssVar);
      // consumed by a font-family rule
      expect(css).toContain(`var(${cssVar})`);
    }
  });
});
