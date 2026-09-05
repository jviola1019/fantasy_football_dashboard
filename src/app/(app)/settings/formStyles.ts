/**
 * The three inline styles every settings form uses, with one home.
 *
 * These objects were copied verbatim into `AccountForms.tsx` and
 * `AddLeagueForm.tsx`. (`LeagueSettingsForm.tsx` has a similar-looking `input`
 * that is deliberately NOT the same — 8px radius and a 40px min-height for its
 * inline number fields — so it is left alone rather than flattened to match.)
 *
 * Identical copies of a *style* fail quietly rather than loudly: nothing breaks
 * when they drift, the forms just stop matching each other, and whoever retunes
 * one has no way to know the other exists. Adding a third copy for the ESPN
 * sign-in form is what made this worth extracting.
 *
 * Values are unchanged from the copies they replace, so this is a de-duplication
 * and not a restyle. Every colour and size reads from a design token — the
 * literals here are the neutral rgba scrims that `globals.css` does not name.
 */

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  color: "var(--cream)",
  fontSize: "var(--text-sm)"
};

export const labelStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--text-xs)",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em"
};

export const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600
};

/** The bordered, unfilled button used for secondary actions in these forms. */
export const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  color: "var(--cream)",
  border: "1px solid rgba(255,255,255,0.18)"
};

/** The same shape in red, for actions that remove something. */
export const destructiveButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  color: "var(--red, #e35e5e)",
  border: "1px solid rgba(227,94,94,0.4)"
};
