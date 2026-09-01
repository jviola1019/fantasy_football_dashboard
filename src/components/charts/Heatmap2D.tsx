"use client";

import { readableInkFor } from "./cellContrast";

// Sprint 3 D5 palette: slate-blue (low) -> warm-amber (mid) -> coral (high).
// Three-band scale matching the --blue / --accent-warm / --red system. Opacity
// ramps within each band so low-value cells are never invisible.
//
// THE ALPHA CEILINGS ARE A LEGIBILITY CONSTRAINT, NOT A TASTE ONE (S5).
// Every cell carries its percentage as text, and 11px text needs 4.5:1
// (WCAG 1.4.3). Solved numerically against this ramp composited over
// `THEME.panel`: the previous ceilings (0.74 blue / 0.82 amber / 0.94 coral)
// produced mid-band cells at a luminance where NEITHER a light nor a dark ink
// reaches 4.5:1 — the best available at v=0.50 was 4.03:1. That is a palette
// defect: no choice of foreground can rescue a background in that band.
//
// The ceilings below keep the whole ramp under the luminance at which the cream
// ink clears AA, so the worst cell on the scale now measures 5.08:1. Verified
// at 101 points by `cellContrast.test.ts`, which also keeps the OLD alphas
// around as a canary proving the change was necessary.
//
// Luminance is not monotone across the three bands — it steps down at each hue
// change. That predates this ramp and is deliberate: the ORDERING is carried by
// hue (cool -> warm -> hot) and by the number printed in every cell, not by
// brightness alone.
export const DEFAULT_COLOR = (v: number): string => {
  if (v < 0.33) {
    const t = v / 0.33;
    return `rgba(74, 141, 183, ${0.22 + t * 0.44})`;       // slate-blue ramp
  }
  if (v < 0.66) {
    const t = (v - 0.33) / 0.33;
    return `rgba(215, 168, 87, ${0.3 + t * 0.2})`;          // warm-amber ramp
  }
  const t = (v - 0.66) / 0.34;
  return `rgba(217, 134, 111, ${0.34 + t * 0.24})`;         // coral ramp
};

interface Props {
  /** 2-D grid of values in [0, 1]. Outer array = rows (yLabels), inner = columns (xLabels). */
  data: number[][];
  xLabels: string[];
  yLabels: string[];
  /** Optional caption rendered below the grid. Shown to everyone. */
  caption?: string;
  /** Names what a row and a column mean, for the table's own caption. */
  rowAxisLabel?: string;
  colAxisLabel?: string;
  /** Optional color scale function. Default is the three-band ramp above. */
  colorScale?: (normalised: number) => string;
}

/**
 * A 2-D heatmap rendered as a real HTML table.
 *
 * S5. This was an SVG: `<rect>` cells with `<text fontSize={9}>` percentages, a
 * `role="img"`, and one long `aria-label` naming every row and column. Two
 * problems, and the second is the serious one.
 *
 * The type: `width="100%"` against a `viewBox` means the 9px labels are USER
 * UNITS, so any container narrower than the natural width rendered them below
 * the 9px floor — 6.9px at the widths this appears at on a phone. It could not
 * be fixed in place, because SVG presentation attributes cannot resolve
 * `var(--text-xs)`.
 *
 * The semantics: a heatmap IS a table. Rendering it as an image and then
 * apologising with an `aria-label` meant a screen-reader user got a single
 * sentence listing the axis labels and **none of the values** — the `<title>` on
 * each cell was unreachable, because `role="img"` makes the subtree
 * presentational. As a `<table>` with `<th scope>` on both axes, every cell is
 * addressable, announced with its row and column, and navigable with table
 * commands. The colour becomes what it always should have been: a redundant
 * encoding of a number that is also written in the cell.
 */
export function Heatmap2D({
  data,
  xLabels,
  yLabels,
  caption,
  rowAxisLabel,
  colAxisLabel,
  colorScale = DEFAULT_COLOR
}: Props) {
  return (
    <div className="heatmap-wrap">
      <table className="heatmap-table">
        <caption className="sr-only">
          {caption
            ? caption
            : `Heatmap of values across ${xLabels.length} columns and ${yLabels.length} rows.`}
        </caption>
        <thead>
          <tr>
            {/* The corner cell labels neither axis; it must not be announced as
                a header for the row headers beneath it. */}
            <td>
              <span className="sr-only">
                {rowAxisLabel && colAxisLabel
                  ? `${rowAxisLabel} by ${colAxisLabel}`
                  : "Row label"}
              </span>
            </td>
            {xLabels.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, r) => (
            <tr key={yLabels[r] ?? r}>
              <th scope="row">{yLabels[r] ?? ""}</th>
              {row.map((val, c) => {
                const background = colorScale(val);
                // Per-cell ink, chosen from the cell's own composited luminance.
                // A fixed light ink measured 4.33:1 on the mid-band amber cells
                // — under the 4.5:1 that 11px text requires, and invisible to
                // axe while these were SVG. See cellContrast.ts.
                const { ink } = readableInkFor(background);
                return (
                  <td
                    key={xLabels[c] ?? c}
                    className="heatmap-cell"
                    style={{ background, color: ink }}
                  >
                    {Math.round(val * 100)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {caption && (
        <div
          className="heatmap-caption"
          // >=11px: this caption is the misread-prevention text
          // (P(outcome | wins), columns sum to 100%) — trust-critical, not
          // decoration (audit F-05). It is aria-hidden because the same string
          // is already the table's <caption>; without this a screen reader reads
          // it twice.
          aria-hidden="true"
        >
          {caption}
        </div>
      )}
    </div>
  );
}
