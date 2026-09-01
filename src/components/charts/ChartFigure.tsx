import type { ReactNode } from "react";

/**
 * The wrapper every genuinely-graphical chart sits in.
 *
 * S5. Charts here described themselves with `role="img"` plus an `aria-label`
 * built by string concatenation. That works, and it has two limits worth
 * removing:
 *
 *   1. `role="img"` makes the subtree presentational, so the `<title>` on each
 *      data point — which some charts went to the trouble of writing — is
 *      unreachable. `ReliabilityDiagram` gives every point a title reporting its
 *      forecast, observed frequency and n, and no assistive technology could
 *      read any of them.
 *   2. An `aria-label` is a single flat string. It cannot carry structure, it is
 *      truncated by some screen readers around 250 characters, and it exists
 *      only in the accessibility tree — so nothing in a normal DOM dump, a
 *      test, or a copy-paste can see it.
 *
 * A `<figure>` with a real `<figcaption>` fixes both. The caption is genuine DOM
 * text (visually hidden, because the chart already shows it graphically), the
 * SVG is `aria-hidden` so it contributes nothing conflicting, and the summary is
 * findable by anything that reads the page rather than only by AT.
 *
 * Charts whose values are already real DOM text — the HTML `BarChart`, the
 * `Heatmap2D` table — do NOT use this. They need no alternative because they are
 * not an image; giving them one would make a screen reader read the data twice.
 */
export function ChartFigure({
  summary,
  children,
  caption,
  className
}: {
  /**
   * What the chart shows, in words, including the numbers. Written as a
   * sentence a person could act on without seeing the graphic — not a
   * description of the axes.
   */
  summary: string;
  children: ReactNode;
  /** Optional VISIBLE caption, shown to everyone under the chart. */
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <figure className={className ? `chart-figure ${className}` : "chart-figure"}>
      {/* aria-hidden: the figcaption is the accessible representation. Without
          this the SVG's own text nodes would be announced as loose fragments
          after the summary. */}
      <div aria-hidden="true">{children}</div>
      <figcaption className="sr-only">{summary}</figcaption>
      {caption ? <div className="chart-caption">{caption}</div> : null}
    </figure>
  );
}
