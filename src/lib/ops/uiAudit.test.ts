import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IN_PAGE_AUDIT,
  MIN_RENDERED_PX,
  SPACE_SCALE,
  TYPE_SCALE,
  nearestScaleStep,
  compositeOver,
  contrastRatio,
  effectiveContrast,
  isOffScale,
  parseRgba,
  relativeLuminance,
  requiredContrast
} from "./uiAudit";

/**
 * The colour maths the UI audit rests on.
 *
 * Worth testing specifically because compositing is where the original bug hid:
 * `--blue` at `opacity: .75` measured 4.13:1 on screen while every automated
 * check read `color` and reported 5.6:1. If `effectiveContrast` were wrong, the
 * audit built on it would be one more green check that is not checking — and it
 * would be a *confident* one.
 */
describe("parseRgba", () => {
  it("reads both forms getComputedStyle returns", () => {
    expect(parseRgba("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseRgba("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("returns null rather than a guess for anything else", () => {
    // A silent {0,0,0} default would report perfect contrast against a dark
    // background — a wrong answer that looks like a good one.
    for (const v of ["", "transparent", "currentColor", "#fff", "color(display-p3 1 1 1)"]) {
      expect(parseRgba(v)).toBeNull();
    }
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("matches the WCAG reference endpoints", () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
    expect(relativeLuminance(black)).toBeCloseTo(0, 10);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 10);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 10);
  });

  it("is symmetric — order of arguments cannot change a verdict", () => {
    const a = { r: 18, g: 24, b: 38, a: 1 };
    const b = { r: 200, g: 210, b: 220, a: 1 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });

  it("agrees with a known published pair", () => {
    // #767676 on #ffffff is the canonical 4.54:1 example for AA body text.
    expect(
      contrastRatio({ r: 0x76, g: 0x76, b: 0x76, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })
    ).toBeCloseTo(4.54, 2);
  });
});

describe("effectiveContrast — the point of the module", () => {
  it("reproduces the bug that started this: --blue at opacity .75", () => {
    // #5aa7d0 on the navy ground reads comfortably at full strength and fails
    // once the compositor applies opacity. Reading `color` alone misses it.
    const fg = { r: 0x5a, g: 0xa7, b: 0xd0, a: 1 };
    const bg = { r: 0x0b, g: 0x11, b: 0x1a, a: 1 };
    const full = effectiveContrast(fg, bg, 1);
    const dimmed = effectiveContrast(fg, bg, 0.75);
    expect(full).toBeGreaterThan(4.5);
    expect(dimmed).toBeLessThan(full);
  });

  it("is monotone in opacity — dimming never improves contrast on a dark ground", () => {
    const fg = { r: 220, g: 230, b: 240, a: 1 };
    const bg = { r: 10, g: 14, b: 22, a: 1 };
    let previous = Infinity;
    for (const o of [1, 0.9, 0.75, 0.5, 0.25, 0.1]) {
      const r = effectiveContrast(fg, bg, o);
      expect(r).toBeLessThanOrEqual(previous + 1e-9);
      previous = r;
    }
  });

  it("collapses to 1:1 at zero opacity, because invisible text has no contrast", () => {
    expect(effectiveContrast({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }, 0)).toBeCloseTo(1, 10);
  });

  it("equals the plain ratio at full opacity", () => {
    const fg = { r: 240, g: 240, b: 240, a: 1 };
    const bg = { r: 20, g: 20, b: 20, a: 1 };
    expect(effectiveContrast(fg, bg, 1)).toBeCloseTo(contrastRatio(fg, bg), 10);
  });

  it("matches the self-test canary the audit ships with", () => {
    // scripts/audit-ui.ts injects #8aa4b8 at 0.55 and expects roughly 3:1. If
    // this drifts, the canary stops being a meaningful probe.
    const r = effectiveContrast(
      { r: 0x8a, g: 0xa4, b: 0xb8, a: 1 },
      { r: 0x0b, g: 0x11, b: 0x1a, a: 1 },
      0.55
    );
    expect(r).toBeGreaterThan(2);
    expect(r).toBeLessThan(4.5);
  });
});

describe("compositeOver", () => {
  it("returns the backdrop for a fully transparent layer", () => {
    const bg = { r: 12, g: 34, b: 56, a: 1 };
    expect(compositeOver({ r: 255, g: 0, b: 0, a: 0 }, bg)).toEqual({ ...bg, a: 1 });
  });

  it("returns the layer for a fully opaque one", () => {
    const fg = { r: 255, g: 0, b: 0, a: 1 };
    expect(compositeOver(fg, { r: 12, g: 34, b: 56, a: 1 })).toEqual({ ...fg, a: 1 });
  });
});

describe("requiredContrast follows WCAG 1.4.3's size rule", () => {
  it("relaxes to 3:1 only for genuinely large text", () => {
    expect(requiredContrast(13, false)).toBe(4.5);
    expect(requiredContrast(23.9, false)).toBe(4.5);
    expect(requiredContrast(24, false)).toBe(3);
    expect(requiredContrast(18.66, true)).toBe(3);
    expect(requiredContrast(18.66, false)).toBe(4.5);
  });
});

describe("isOffScale", () => {
  it("accepts every declared step and zero", () => {
    for (const s of SPACE_SCALE) expect(isOffScale(s)).toBe(false);
    expect(isOffScale(0)).toBe(false);
  });

  it("catches the values that actually turned up", () => {
    // Measured on the real pages: a 14px panel header, a 20px tab gap and a
    // 64px footer, all of which sit between declared steps.
    expect(isOffScale(14)).toBe(true);
    expect(isOffScale(20)).toBe(true);
    expect(isOffScale(64)).toBe(true);
  });

  it("tolerates sub-pixel rounding rather than reporting it", () => {
    expect(isOffScale(15.5)).toBe(false);
    expect(isOffScale(16.49)).toBe(false);
  });

  it("ignores non-finite values instead of flagging them", () => {
    expect(isOffScale(NaN)).toBe(false);
  });
});

describe("the in-page program is well-formed", () => {
  it("carries a __name shim", () => {
    // Without it, every serialised function containing an inner named function
    // throws ReferenceError in the page — which is exactly how the opacity check
    // silently never ran across ten routes.
    expect(IN_PAGE_AUDIT).toContain("const __name = (fn) => fn;");
  });

  it("parses as a program", () => {
    // The check that would have caught both nested-language hazards this file
    // hit. An unescaped backtick closed the template literal early (esbuild:
    // "Expected ; but found body"); a stray control character corrupts it more
    // quietly.
    //
    // Parsed with esbuild rather than `new Function`, which would build a
    // callable from an interpolated string — safe here, since the input is a
    // module constant, but a pattern that stops being safe the moment someone
    // parameterises it. transformSync only parses.
    expect(() => transformSync(IN_PAGE_AUDIT, { loader: "js" })).not.toThrow();
  });

  it("contains no control characters", () => {
    // A backslash-b written inside the template literal compiles to a literal
    // backspace byte rather than a regex word boundary — the same defect a
    // previous audit found in a regex, and one that is invisible in a diff.
    const control = [...IN_PAGE_AUDIT].filter((c) => {
      const code = c.charCodeAt(0);
      return code < 32 && c !== "\n" && c !== "\r" && c !== "\t";
    });
    expect(control).toEqual([]);
  });

  it("inlines the same helpers this file tests, rather than a second copy", () => {
    for (const name of ["parseRgba", "compositeOver", "effectiveContrast", "isOffScale", "nearestScaleStep"]) {
      expect(IN_PAGE_AUDIT).toContain(`const ${name} =`);
    }
  });

  it("binds TYPE_SCALE by name, because the closure does not survive serialisation", () => {
    // The same defect SPACE_SCALE hit on its first run: `nearestScaleStep`
    // refers to TYPE_SCALE by name, and Function.prototype.toString drops the
    // closure, so the in-page binding must carry that exact identifier or the
    // whole scan dies with a ReferenceError.
    expect(IN_PAGE_AUDIT).toContain("const TYPE_SCALE =");
    expect(IN_PAGE_AUDIT).toContain("const MIN_RENDERED_PX =");
    expect(IN_PAGE_AUDIT).toContain("const BOTTOM_HEAVY_LIMIT =");
  });

  it("reports how much it scanned, so a zero can be distinguished from a no-op", () => {
    for (const counter of [
      "textElements",
      "focusables",
      "spacingBoxes",
      "panels",
      "targetsMeasured",
      "sizedTextElements",
      "primaryCtas"
    ]) {
      expect(IN_PAGE_AUDIT).toContain(`out.scanned.${counter}`);
    }
  });
});

describe("nearestScaleStep", () => {
  it("maps each declared rung to itself", () => {
    for (const step of TYPE_SCALE) expect(nearestScaleStep(step)).toBe(step);
  });

  it("absorbs sub-pixel browser rounding", () => {
    // A computed 13.008px is still --text-sm. A gate that called that off-scale
    // would fire on every route and be switched off within a week.
    expect(nearestScaleStep(13.008)).toBe(13);
    expect(nearestScaleStep(10.5)).toBe(11);
    expect(nearestScaleStep(44.4)).toBe(44);
  });

  it("returns null for sizes genuinely off the ladder", () => {
    // 14 and 18 are the classic ad-hoc values; both sit more than 1.5px from
    // any rung.
    expect(nearestScaleStep(14.9)).toBeNull();
    expect(nearestScaleStep(18)).toBeNull();
    expect(nearestScaleStep(30)).toBeNull();
  });

  it("refuses nonsense rather than guessing", () => {
    expect(nearestScaleStep(0)).toBeNull();
    expect(nearestScaleStep(-12)).toBeNull();
    expect(nearestScaleStep(NaN)).toBeNull();
    expect(nearestScaleStep(Infinity)).toBeNull();
  });

  it("does not silently accept the sub-floor SVG case", () => {
    // fontSize="8" in a 560-unit viewBox laid out at ~360 CSS px renders around
    // 5px. It must not round up to the 9px rung and disappear.
    const rendered = 8 * (360 / 560);
    expect(rendered).toBeLessThan(MIN_RENDERED_PX);
    expect(nearestScaleStep(rendered)).toBeNull();
  });
});

describe("the scale mirrors the stylesheet", () => {
  it("matches globals.css:106-113 exactly, in order", () => {
    // If the CSS ladder changes and this array does not, every bucket is wrong
    // and the histogram quietly lies. typeScale.test.ts guards the CSS side;
    // this guards that the audit is looking at the same ladder.
    const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    const declared = [...css.matchAll(/--text-[a-z0-9]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(declared).toEqual([...TYPE_SCALE]);
  });

  it("puts the floor on the bottom rung", () => {
    expect(MIN_RENDERED_PX).toBe(TYPE_SCALE[0]);
  });
});
