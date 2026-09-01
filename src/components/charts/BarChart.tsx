export type BarItem = {
  label: string;
  value: number;
  /** Text at the row end. Defaults to `value` + `valueSuffix`. */
  valueLabel?: string;
  /** Secondary text after the label, e.g. "· you". */
  note?: string;
  color?: string;
  /** Draw this row as the reader's own — brighter text, accent bar. */
  emphasis?: boolean;
  /** Overrides the row's text alternative. Default states label and value. */
  ariaLabel?: string;
};

type BarChartProps = {
  items: BarItem[];
  max?: number;
  /** Suffix appended to each value label. Default "%". Pass "" for raw counts. */
  valueSuffix?: string;
  /** Accessible name for the list as a whole. */
  ariaLabel?: string;
};

/**
 * Horizontal bars — HTML, not SVG.
 *
 * S5. This was an `<svg viewBox="0 0 280 H" width="100%">` with `fontSize="10"`
 * on every label. SVG font sizes are USER UNITS: the viewBox scales them with
 * the container, so inside the `mini-panel` on `/analytics` — about 198px wide
 * against a 280-unit viewBox — every label rendered at **7.1px**. Measured, not
 * estimated: `scripts/audit-ui.ts` reported all ten of them at 7.1px against the
 * 9px floor, and that was the entire element-level type-scale debt in the
 * product.
 *
 * It also could not be fixed inside SVG. Presentation attributes cannot resolve
 * `var(--text-xs)`, which is exactly why `typeScale.test.ts` exempts SVG
 * `fontSize` props from its ban — the exemption is honest about the constraint
 * and does nothing about the consequence. HTML has no such constraint: the text
 * is now on the type scale, scales with user font settings, and reflows instead
 * of shrinking.
 *
 * There is no accessible-summary prop because it needs none. Every label and
 * value is real DOM text; adding a text alternative would make a screen reader
 * read the same numbers twice. See `ChartFigure` for the charts that do need one.
 */
export function BarChart({ items, max, valueSuffix = "%", ariaLabel }: BarChartProps) {
  const maxVal = max ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="bar-chart" aria-label={ariaLabel}>
      {items.map((item) => {
        const valueLabel = item.valueLabel ?? `${item.value}${valueSuffix}`;
        // A true zero renders an empty track; anything non-zero keeps a
        // minimum width so a small value is still visible as a bar.
        const pct = item.value > 0 ? Math.max(1.5, (item.value / maxVal) * 100) : 0;
        return (
          <li key={item.label} className={`bar-row${item.emphasis ? " bar-row-emphasis" : ""}`}>
            <span className="bar-label">
              {item.label}
              {item.note ? <span className="bar-note"> {item.note}</span> : null}
            </span>
            <span
              className="bar-track"
              role="img"
              aria-label={item.ariaLabel ?? `${item.label}: ${valueLabel}`}
            >
              <span
                className="bar-fill"
                style={{
                  ["--bar-pct" as string]: `${pct}%`,
                  ...(item.color ? { ["--bar-color" as string]: item.color } : {})
                }}
              />
            </span>
            <span className="bar-value">{valueLabel}</span>
          </li>
        );
      })}
    </ul>
  );
}
