import { THEME } from "@/lib/theme";

/**
 * Pick a readable foreground for a heatmap cell, from the cell's own colour.
 *
 * S5, and this is a fix for a defect that PREDATES the chart kit — it was simply
 * unmeasurable before. The heatmap drew its percentages as SVG `<text>` in
 * `rgba(255,255,255,0.85)` over the colour ramp. axe does not evaluate contrast
 * inside SVG, so `03-a11y.spec.ts` passed on `/analytics` for months while the
 * mid-band amber cells sat at roughly 4.3:1 against the 4.5:1 that 11px text
 * requires. Rendering the same numbers as HTML did not create the problem; it
 * made the checker able to see it, and axe reported it immediately.
 *
 * Two steps, because neither alone is sufficient:
 *
 *   1. COMPOSITE. The ramp returns `rgba(...)` with alpha, so the colour a
 *      reader actually sees is the ramp blended over the panel behind it. Judging
 *      contrast against the unblended ramp colour would be judging a colour that
 *      is never on screen.
 *   2. CHOOSE. Against the composited cell, take whichever of the light and dark
 *      inks has the higher contrast ratio. Across a ramp that runs from a dark
 *      slate-blue to a light amber, no single foreground can clear 4.5:1
 *      everywhere — which is exactly why a fixed white was failing in the middle.
 */

/** WCAG 2.x relative luminance. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.x contrast ratio between two luminances. Always >= 1. */
export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)`. Returns null if unparseable. */
export function parseColor(value: string): (Rgb & { a: number }) | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (!fn) return null;
  const parts = fn[1]!.split(",").map((p) => Number(p.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  const a = parts.length > 3 && Number.isFinite(parts[3]!) ? parts[3]! : 1;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a };
}

/** Source-over composite of `fg` (with alpha) onto opaque `bg`. */
export function compositeOver(fg: Rgb & { a: number }, bg: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, fg.a));
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a))
  };
}

/** The two inks a cell may use. Both exist in the design system already. */
export const CELL_INK_LIGHT = THEME.cream;
/** The page ground (THEME.bg), reused as an ink on light cells so no new colour enters the system. */
export const CELL_INK_DARK = THEME.bg;

/**
 * The readable ink for a cell painted `cellColor` over `bgColor`, plus the
 * contrast it achieves — returned so a test can assert the number rather than
 * trust the choice.
 */
export function readableInkFor(
  cellColor: string,
  bgColor: string = THEME.panel
): { ink: string; ratio: number } {
  const bgParsed = parseColor(bgColor) ?? { r: 17, g: 24, b: 39, a: 1 };
  const bg: Rgb = { r: bgParsed.r, g: bgParsed.g, b: bgParsed.b };
  const cellParsed = parseColor(cellColor);
  // An unparseable cell colour falls back to the light ink: the same behaviour
  // as before this function existed, rather than a crash or an invisible cell.
  if (!cellParsed) return { ink: CELL_INK_LIGHT, ratio: 0 };
  const cell = compositeOver(cellParsed, bg);
  const cellL = relativeLuminance(cell.r, cell.g, cell.b);

  const light = parseColor(CELL_INK_LIGHT)!;
  const dark = parseColor(CELL_INK_DARK)!;
  const lightRatio = contrastRatio(cellL, relativeLuminance(light.r, light.g, light.b));
  const darkRatio = contrastRatio(cellL, relativeLuminance(dark.r, dark.g, dark.b));

  return lightRatio >= darkRatio
    ? { ink: CELL_INK_LIGHT, ratio: lightRatio }
    : { ink: CELL_INK_DARK, ratio: darkRatio };
}
