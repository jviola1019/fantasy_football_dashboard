"use client";

import { useState, useTransition } from "react";
import { updateLeagueIdentity } from "./actions";

/**
 * Which Sleeper account is yours — editable, and loud when it is missing.
 *
 * Audit 2026-08-31 (D-D). `sleeperUsername` was written once, at league-add
 * time, and never again. When it is absent or does not match a member of the
 * league, `resolveSleeperRosterId` returns null and `fetchLive.ts:334`
 * substitutes `sleeperRosters[0]` — the first team in the league, which is
 * almost never yours.
 *
 * The substitution was declared, but only as one line inside the assumptions
 * drawer. Post-draft that is nowhere near loud enough: a stranger's drafted
 * roster then drives the roster view, the season simulation, Roster Health and
 * Next Best Actions, and every one of those looks entirely normal. The old
 * remedy was to delete the league and re-add it, which also discarded the
 * keeper settings the owner had confirmed.
 *
 * Deliberately a SEPARATE component from `LeagueSettingsForm`, which returns
 * early when the platform format has not been detected yet. Identity has to be
 * fixable in exactly that state — a league that is not resolving properly is
 * when you most need to correct the username.
 */
export function LeagueIdentityForm({
  leagueId,
  label,
  platform,
  sleeperUsername
}: {
  leagueId: string;
  label: string;
  platform: "sleeper" | "espn";
  sleeperUsername: string | null;
}) {
  const [value, setValue] = useState(sleeperUsername ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ESPN identifies the team from the cookie's own account, so there is nothing
  // for an owner to state.
  if (platform !== "sleeper") return null;

  const missing = !sleeperUsername;

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const res = await updateLeagueIdentity(formData);
      setMessage(res.ok ? "Saved. Your team will resolve on the next page load." : res.error);
    });
  };

  return (
    <form action={onSubmit} style={{ display: "grid", gap: 10, marginTop: 16 }}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <div className="section-label">
        YOUR TEAM
        {missing && <span style={{ color: "var(--amber)" }}> · not set</span>}
      </div>

      {missing && (
        <p
          role="note"
          className="muted"
          style={{
            margin: 0,
            padding: 8,
            borderLeft: "2px solid var(--amber)",
            fontSize: "var(--text-xs)",
            color: "var(--gov-text)"
          }}
        >
          RAE cannot tell which team in {label} is yours, so it is showing the{" "}
          <strong>first team in the league</strong>. Your roster, season simulation, roster health
          and recommended actions all describe that team, not yours. Enter your Sleeper username to
          fix it.
        </p>
      )}

      <label htmlFor={`sleeperUsername-${leagueId}`} style={{ fontSize: "var(--text-xs)" }}>
        Sleeper username
      </label>
      <input
        id={`sleeperUsername-${leagueId}`}
        name="sleeperUsername"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="your Sleeper username"
        autoComplete="off"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          color: "var(--cream)",
          fontSize: "var(--text-sm)",
          padding: 8
        }}
      />
      <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: -4 }}>
        Matched against the usernames and display names in this league. Leaving it empty is allowed —
        RAE will say it is showing the first team rather than imply otherwise.
      </p>

      <button type="submit" className="btn-primary" disabled={pending} style={{ justifySelf: "start" }}>
        {pending ? "Saving…" : "Save"}
      </button>
      {message && (
        <p className="muted" role="status" style={{ fontSize: "var(--text-xs)" }}>
          {message}
        </p>
      )}
    </form>
  );
}
