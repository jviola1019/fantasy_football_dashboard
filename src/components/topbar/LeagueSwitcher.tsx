"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveLeagueAction } from "@/app/settings/leagues/actions";

export interface LeagueOption {
  id: string;
  label: string;
  platform: "sleeper" | "espn";
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
 * homepage envelope. Hidden when the user has 0 leagues (NoLeagueCTA covers
 * that case) and renders as a static label when there's only 1 league.
 *
 * On change, calls setActiveLeagueAction which writes the active-league
 * cookie + revalidatePath("/") so the next render uses the new league.
 * router.refresh() is also called to push the result through immediately
 * without a full nav.
 */
export function LeagueSwitcher({ leagues, activeLeagueId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (leagues.length === 0) return null;
  const active = activeLeagueId ?? leagues[0]!.id;
  if (leagues.length === 1) {
    const only = leagues[0]!;
    return (
      <span
        title={`${PLATFORM_LABEL[only.platform]} league`}
        style={labelOnlyStyle}
      >
        <span style={glyphStyle} aria-hidden="true">
          {PLATFORM_GLYPH[only.platform]}
        </span>
        <span style={labelStyle}>{only.label}</span>
      </span>
    );
  }
  return (
    <label style={wrapperStyle}>
      <span style={srOnlyStyle}>Active league</span>
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
    </label>
  );
}

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

const wrapperStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  position: "relative"
};

const selectStyle: React.CSSProperties = {
  appearance: "none",
  background: "rgba(0,0,0,0.35)",
  color: "var(--cream)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "6px 28px 6px 10px",
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: 0.2,
  cursor: "pointer",
  maxWidth: 180
};

const labelOnlyStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8,
  fontSize: 11,
  color: "var(--muted)"
};

const glyphStyle: React.CSSProperties = {
  fontFamily: "var(--monospace-font, monospace)",
  fontWeight: 700,
  color: "var(--amber)",
  fontSize: 11
};

const labelStyle: React.CSSProperties = {
  letterSpacing: 0.2,
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};
