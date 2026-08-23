/**
 * The RAE palette, in JavaScript.
 *
 * WHY THIS EXISTS (design audit 2026-08-22, finding D-5).
 *
 * The palette lives in `globals.css` as custom properties, which is the right
 * home for it — except that SVG **presentation attributes** (`fill="…"`,
 * `stroke="…"`) cannot resolve `var()`. Every chart therefore hard-coded its
 * own hex values, and a whole PRE-REPAINT palette survived there long after the
 * tokens moved: `#77d7b0` where green is now `#35c08a`, `#d9866f` where red is
 * now `#eb5f54`, `#8d9aa0` where muted is `#8898aa`. The charts were painted in
 * the colours of a design that no longer existed, and nothing could detect it —
 * a colour regression is invisible to typecheck, lint, axe and Playwright
 * alike.
 *
 * So: one palette, two consumers. CSS reads the custom properties; charts read
 * these constants; `theme.test.ts` fails the build if the two ever disagree.
 * That test is the entire point of the file — without it this is just a second
 * place for the palette to drift.
 *
 * Use `var(--token)` in CSS and in `style={{}}` objects. Use these constants
 * ONLY where a `var()` cannot reach: SVG presentation attributes, and canvas.
 */
export const THEME = {
  bg: "#0b1120",
  panel: "#111827",
  panel2: "#18222f",
  cream: "#f0ece4",
  muted: "#8898aa",
  amber: "#d7a857",
  green: "#35c08a",
  teal: "#2fb6c4",
  red: "#eb5f54",
  blue: "#5a9fc4",
  purple: "#8b7be0",
  govText: "#e8d9b0",
  labelText: "#d8dece"
} as const;

export type ThemeColor = keyof typeof THEME;

/**
 * The five mutually exclusive season-outcome buckets, in rank order.
 *
 * Ordered best → worst, and coloured so the ordering is legible without reading
 * the labels: amber for the championship (the product's attention colour),
 * green and blue for good outcomes, muted grey for the indifferent middle, red
 * for the bottom. Five distinguishable hues drawn from the palette rather than
 * five invented ones.
 */
export const OUTCOME_COLORS = {
  championship: THEME.amber,
  topThree: THEME.green,
  playoffs: THEME.blue,
  middlePack: THEME.muted,
  bottomThree: THEME.red
} as const;
