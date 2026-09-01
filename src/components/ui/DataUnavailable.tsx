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
    <div role="status" className="data-unavailable" style={wrapperStyle}>
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

// Dot-grid at 4% opacity — visually distinct from "loading" (per Sprint 3 D2).
// Uses slate-blue (#4a8db7) to match the new panel accent system.
const hatchStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage: "radial-gradient(circle, rgba(74, 141, 183, 0.32) 1px, transparent 1px)",
  backgroundSize: "14px 14px",
  opacity: 0.4
};

const contentStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gap: 6,
  // A grid item's default `min-width: auto` refuses to shrink below its content,
  // so an unbreakable token pushed this past the wrapper and `overflow: hidden`
  // then clipped the text mid-word.
  minWidth: 0
};

const captionStyle: React.CSSProperties = {
  fontFamily: "var(--monospace-font, monospace)",
  fontSize: "var(--text-xs)",
  letterSpacing: "0.03em",
  color: "var(--muted)",
  textTransform: "uppercase",
  minWidth: 0,
  overflowWrap: "anywhere"
};

const titleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "var(--cream)",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  letterSpacing: "0.02em",
  minWidth: 0,
  overflowWrap: "anywhere"
};

const descStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.5,
  // These descriptions routinely name an API route or a field, and those have no
  // break opportunity. Without this the sidebar rendered "/api/leagues/[id]/refres"
  // — a truncated instruction is worse than none, since it reads as complete.
  minWidth: 0,
  overflowWrap: "anywhere"
};
