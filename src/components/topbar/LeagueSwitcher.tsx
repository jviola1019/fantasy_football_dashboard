"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveLeagueAction } from "@/app/(app)/settings/leagues/actions";

export interface LeagueOption {
  id: string;
  label: string;
  platform: "sleeper" | "espn";
  /** League season year (e.g. 2026). Shown as a prominent badge in the switcher. */
  season: number;
}

interface Props {
  leagues: LeagueOption[];
  activeLeagueId: string | null;
}

const PLATFORM_GLYPH: Record<LeagueOption["platform"], string> = {
  sleeper: "S",
  espn: "E"
};

const PLATFORM_LABEL: Record<LeagueOption["platform"], string> = {
  sleeper: "Sleeper",
  espn: "ESPN"
};

/**
 * Topbar control letting the user pick which connected league drives the
 * homepage envelope. Rendered as ONE joined pill: an amber season-year chip
 * flush against the league control, so the year is unmistakable and never
 * duplicated in the league name. Hidden when the user has 0 leagues; a static
 * pill when there's only 1.
 *
 * On change, calls setActiveLeagueAction (writes the active-league cookie +
 * revalidatePath("/")), then router.refresh() to push the result through.
 */
export function LeagueSwitcher({ leagues, activeLeagueId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (leagues.length === 0) return null;
  const active = activeLeagueId ?? leagues[0]!.id;

  if (leagues.length === 1) {
    const only = leagues[0]!;
    return (
      <span style={wrapperStyle} title={`${PLATFORM_LABEL[only.platform]} league · ${only.season} season`}>
        <span style={seasonBadgeStyle} aria-label={`${only.season} season`}>{only.season}</span>
        <span style={labelOnlyStyle}>
          <span style={glyphStyle} aria-hidden="true">{PLATFORM_GLYPH[only.platform]}</span>
          <span style={labelTextStyle}>{only.label}</span>
        </span>
      </span>
    );
  }

  const activeLeague = leagues.find((l) => l.id === active) ?? leagues[0]!;
  return (
    <label style={wrapperStyle}>
      <span style={srOnlyStyle}>Active league</span>
      {/* Amber year chip, flush against the select — year is obvious, shown once. */}
      <span style={seasonBadgeStyle} aria-label={`${activeLeague.season} season`}>{activeLeague.season}</span>
      <span style={selectWrapStyle}>
        <select
          value={active}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            if (next === active) return;
            startTransition(async () => {
              const result = await setActiveLeagueAction(next);
              if (result.ok) router.refresh();
            });
          }}
          style={selectStyle}
          aria-label="Switch active league"
        >
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {PLATFORM_GLYPH[l.platform]} · {l.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true" style={caretStyle}>▾</span>
      </span>
    </label>
  );
}

// A consistent control height for the joined badge + select/label.
const CONTROL_H = 30;

const wrapperStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "stretch",
  height: CONTROL_H,
  position: "relative"
};

const seasonBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontFamily: "var(--monospace-font, monospace)",
  fontWeight: 700,
  fontSize: 12,
  color: "#0b0e13",
  background: "var(--amber)",
  borderRadius: "7px 0 0 7px",
  padding: "0 9px",
  letterSpacing: 0.4,
  whiteSpace: "nowrap"
};

const selectWrapStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "stretch"
};

const selectStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  background: "rgba(0,0,0,0.35)",
  color: "var(--cream)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderLeft: "none",
  borderRadius: "0 7px 7px 0",
  padding: "0 26px 0 10px",
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: 0.2,
  cursor: "pointer",
  maxWidth: 240,
  height: "100%"
};

const caretStyle: React.CSSProperties = {
  position: "absolute",
  right: 9,
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: 10,
  color: "var(--muted)",
  pointerEvents: "none"
};

const labelOnlyStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderLeft: "none",
  borderRadius: "0 7px 7px 0",
  padding: "0 12px",
  fontSize: 12,
  color: "var(--cream)"
};

const glyphStyle: React.CSSProperties = {
  fontFamily: "var(--monospace-font, monospace)",
  fontWeight: 700,
  color: "var(--amber)",
  fontSize: 11
};

const labelTextStyle: React.CSSProperties = {
  letterSpacing: 0.2,
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const srOnlyStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0
};
