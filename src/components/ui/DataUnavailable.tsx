import type { ReactNode } from "react";

/**
 * Honest "data source not integrated" affordance. Used as the body fallback
 * for panels whose primary metric depends on a behavioral field that no
 * adapter populates (fragility, narrative sentiment, in-season opportunity).
 *
 * Design intent (per the plan's aesthetic-direction brief):
 * - Hatched/grid pattern background instead of empty grey — visually
 *   distinct from "loading" so users never wait for something that's not
 *   coming.
 * - Mono caption pattern, no color signal (don't make "missing" look like
 *   "negative").
 * - Optional children slot so callers can layer partial data (e.g. a
 *   roster list under a "metric unavailable" banner).
 */
interface Props {
  title?: string;
  description: string;
  children?: ReactNode;
}

export function DataUnavailable({ title = "Data source not integrated", description, children }: Props) {
  return (
    <div role="status" style={wrapperStyle}>
      <div aria-hidden="true" style={hatchStyle} />
      <div style={contentStyle}>
        <div style={captionStyle}>{"// data source not integrated"}</div>
        <h3 style={titleStyle}>{title}</h3>
        <p style={descStyle}>{description}</p>
        {children}
      </div>
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  position: "relative",
  background: "rgba(0,0,0,0.25)",
  border: "1px dashed rgba(255,255,255,0.12)",
  borderRadius: 10,
  padding: 24,
  minHeight: 140,
  overflow: "hidden"
};

const hatchStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  opacity: 0.18,
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0, transparent 8px, rgba(255,255,255,0.06) 8px, rgba(255,255,255,0.06) 9px)"
};

const contentStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gap: 6
};

const captionStyle: React.CSSProperties = {
  fontFamily: "var(--monospace-font, monospace)",
  fontSize: 10,
  letterSpacing: 0.3,
  color: "var(--muted)",
  textTransform: "uppercase"
};

const titleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "var(--cream)",
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: 0.2
};

const descStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.5
};
