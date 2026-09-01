import { describe, expect, it } from "vitest";
import {
  compositeOver,
  contrastRatio,
  parseColor,
  readableInkFor,
  relativeLuminance,
  CELL_INK_DARK,
  CELL_INK_LIGHT
} from "./cellContrast";
import { DEFAULT_COLOR } from "./Heatmap2D";

/**
 * The heatmap's cell text must clear WCAG 1.4.3 across the WHOLE ramp.
 *
 * This is asserted as a measured number at every point on the scale rather than
 * as "we picked a sensible ink", because the previous arrangement also looked
 * sensible — a fixed 85% white — and sat at 4.33:1 on the mid-band amber cells
 * for months. It survived because the text was SVG, and axe does not evaluate
 * contrast inside SVG, so `03-a11y.spec.ts` reported /analytics clean the entire
 * time. The check that would have caught it could not see it.
 */

/** 11px normal-weight text is not "large text": the threshold is 4.5:1. */
const AA_NORMAL = 4.5;

describe("the WCAG primitives are right before anything is built on them", () => {
  it("computes the reference luminances for black and white", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 6);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
  });

  it("computes the reference 21:1 contrast of black on white", () => {
    expect(contrastRatio(relativeLuminance(255, 255, 255), relativeLuminance(0, 0, 0))).toBeCloseTo(21, 4);
  });

  it("is symmetric, and never returns less than 1", () => {
    const a = relativeLuminance(120, 30, 200);
    const b = relativeLuminance(10, 200, 40);
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
    expect(contrastRatio(a, a)).toBeCloseTo(1, 10);
  });

  it("parses every colour form the ramp and the theme actually emit", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#111827")).toEqual({ r: 17, g: 24, b: 39, a: 1 });
    expect(parseColor("rgb(74, 141, 183)")).toEqual({ r: 74, g: 141, b: 183, a: 1 });
    expect(parseColor("rgba(74, 141, 183, 0.5)")).toEqual({ r: 74, g: 141, b: 183, a: 0.5 });
    expect(parseColor("not a colour")).toBeNull();
  });

  it("composites alpha the way the browser does", () => {
    // Half-opacity white over black is mid grey.
    expect(compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 })).toEqual({
      r: 128,
      g: 128,
      b: 128
    });
    // Fully opaque ignores the ground entirely.
    expect(compositeOver({ r: 10, g: 20, b: 30, a: 1 }, { r: 200, g: 200, b: 200 })).toEqual({
      r: 10,
      g: 20,
      b: 30
    });
  });
});

describe("every cell on the ramp clears AA for 11px text", () => {
  // 101 samples across [0, 1] — the ramp is piecewise with breaks at 0.33 and
  // 0.66, and a three-point spot check would step straight over the band the
  // old fixed ink actually failed in.
  const samples = Array.from({ length: 101 }, (_, i) => i / 100);

  it("picks an ink clearing 4.5:1 at every point on the default ramp", () => {
    const failures: string[] = [];
    for (const v of samples) {
      const color = DEFAULT_COLOR(v);
      const { ink, ratio } = readableInkFor(color);
      if (ratio < AA_NORMAL) {
        failures.push(`v=${v.toFixed(2)} ${color} ink=${ink} ratio=${ratio.toFixed(2)}`);
      }
    }
    expect(failures, `cells below ${AA_NORMAL}:1:\n${failures.join("\n")}`).toEqual([]);
  });

  it("proves the change was necessary: the OLD ramp had cells NO ink could rescue", () => {
    // The pre-S5 alphas, kept verbatim. At v=0.50 the composited cell reached a
    // luminance where cream measured 4.03:1 and the dark ink 3.96:1 - the best
    // available foreground was still under AA. That is why the ramp itself was
    // retuned rather than only the ink being chosen well.
    const OLD_RAMP = (v: number): string => {
      if (v < 0.33) return `rgba(74, 141, 183, ${0.22 + (v / 0.33) * 0.52})`;
      if (v < 0.66) return `rgba(215, 168, 87, ${0.38 + ((v - 0.33) / 0.33) * 0.44})`;
      return `rgba(217, 134, 111, ${0.52 + ((v - 0.66) / 0.34) * 0.42})`;
    };
    const unrescuable = samples.filter((v) => readableInkFor(OLD_RAMP(v)).ratio < AA_NORMAL);
    expect(
      unrescuable.length,
      "the old ramp is supposed to fail here; if it passes, this canary is dead"
    ).toBeGreaterThan(0);
    // And the worst of them is the mid-amber cell axe actually reported.
    expect(readableInkFor(OLD_RAMP(0.5)).ratio).toBeLessThan(4.1);
  });

  it("keeps the whole tuned ramp on ONE ink, so no cell sits near the crossover", () => {
    // With the ceilings applied, cream clears AA everywhere. A ramp that had to
    // switch inks mid-scale would be one passing close to the luminance where
    // both inks are marginal.
    const inks = new Set(samples.map((v) => readableInkFor(DEFAULT_COLOR(v)).ink));
    expect(inks).toEqual(new Set([CELL_INK_LIGHT]));
  });

  it("still switches ink for a caller that supplies its own light scale", () => {
    // Both heatmap call sites pass a custom `colorScale`, so the chooser has to
    // stay live for colours this ramp never produces.
    const light = readableInkFor("rgba(240, 236, 228, 1)");
    expect(light.ink).toBe(CELL_INK_DARK);
    expect(light.ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("falls back to the light ink rather than crashing on an unparseable colour", () => {
    expect(readableInkFor("var(--nope)").ink).toBe(CELL_INK_LIGHT);
  });

  it("judges contrast against the COMPOSITED colour, not the raw rgba", () => {
    // A 22%-alpha blue over the dark panel is nearly the panel colour. Judging
    // the raw rgba would treat it as a light cell and pick the dark ink, which
    // would be unreadable on screen.
    const nearlyTransparent = "rgba(74, 141, 183, 0.22)";
    expect(readableInkFor(nearlyTransparent).ink).toBe(CELL_INK_LIGHT);
  });
});
