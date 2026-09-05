"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputStyle as input, labelStyle as label } from "../formStyles";
import { addLeague } from "./actions";


/**
 * `hasAccountEspnSignIn` changes what this form ASKS FOR, not just what it says.
 * With an account pair saved, the cookie fields collapse into an opt-in
 * override — because re-pasting an account-wide secret per league was the
 * original defect, and a form that still demands it has not been fixed by a
 * sentence of reassurance underneath it.
 */
export function AddLeagueForm({ hasAccountEspnSignIn = false }: { hasAccountEspnSignIn?: boolean }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<"sleeper" | "espn">("sleeper");
  const [error, setError] = useState<string | null>(null);
  // A non-error the user still needs to see — today, the season correction.
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Only meaningful when an account pair exists; without one the cookies are
  // not an override, they are the only credentials there are.
  const [overrideCookies, setOverrideCookies] = useState(false);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setError(null);
    setNote(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await addLeague(formData);
      if (result.ok) {
        form.reset();
        setNote(result.note ?? null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label htmlFor="platform" style={label}>Platform</label>
          <select
            id="platform"
            name="platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "sleeper" | "espn")}
            style={input}
          >
            <option value="sleeper">Sleeper</option>
            <option value="espn">ESPN</option>
          </select>
        </div>
        <div>
          <label htmlFor="season" style={label}>Season</label>
          <input id="season" name="season" type="number" defaultValue={new Date().getFullYear()} required style={input} />
        </div>
      </div>
      <div>
        <label htmlFor="label" style={label}>Label</label>
        <input id="label" name="label" required placeholder="Friday Night Funk" style={input} />
      </div>
      <div>
        <label htmlFor="externalLeagueId" style={label}>League ID</label>
        <input id="externalLeagueId" name="externalLeagueId" required placeholder="e.g. 123456789012345678" style={input} />
      </div>
      {platform === "espn" ? (
        <div aria-live="polite" style={{ display: "grid", gap: 12, padding: 12, background: "rgba(0,0,0,0.25)", borderRadius: 8 }}>
          {hasAccountEspnSignIn ? (
            <>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                This league will use your saved ESPN sign-in. Nothing more to paste.
              </p>
              <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--muted)", fontSize: "var(--text-sm)", minHeight: 24 }}>
                <input
                  type="checkbox"
                  checked={overrideCookies}
                  onChange={(e) => setOverrideCookies(e.target.checked)}
                  // WCAG 2.2 AA SC 2.5.8 wants a 24x24 target. The label is
                  // clickable too, but the box is what a pointer aims at.
                  style={{ width: 24, height: 24, accentColor: "var(--amber)" }}
                />
                This league is under a different ESPN login
              </label>
            </>
          ) : null}
          {!hasAccountEspnSignIn || overrideCookies ? (
            <>
              <p id="espn-creds-instructions" style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                In a browser logged into ESPN, open DevTools → Application → Cookies → fantasy.espn.com. Copy <code>espn_s2</code> and <code>SWID</code>.
                {hasAccountEspnSignIn ? " These are stored for this league only and take priority over your account sign-in." : " Saved to your account, so every ESPN league you add can use them."}
              </p>
              <div>
                <label htmlFor="espnS2" style={label}>espn_s2</label>
                <input id="espnS2" name="espnS2" type="password" required aria-describedby="espn-creds-instructions" style={input} />
              </div>
              <div>
                <label htmlFor="swid" style={label}>SWID</label>
                <input id="swid" name="swid" type="password" required placeholder="{ABCD-1234-...}" aria-describedby="espn-creds-instructions" style={input} />
              </div>
              {/* Decides whether the pasted pair becomes the account sign-in or
                  a league-only override. Hidden because the checkbox above is
                  the control the user actually reasons about. */}
              <input type="hidden" name="credentialScope" value={overrideCookies ? "league" : "account"} />
            </>
          ) : null}
        </div>
      ) : (
        <div>
          <label htmlFor="sleeperUsername" style={label}>Sleeper username (optional — identifies your team)</label>
          <input id="sleeperUsername" name="sleeperUsername" type="text" placeholder="your Sleeper username" style={input} />
        </div>
      )}
      {error ? <p role="alert" aria-live="polite" style={{ color: "var(--red)", margin: 0, fontSize: "var(--text-sm)" }}>{error}</p> : null}
      {note ? <p role="status" aria-live="polite" style={{ color: "var(--amber)", margin: 0, fontSize: "var(--text-sm)" }}>{note}</p> : null}
      <button
        type="submit"
        disabled={pending}
        style={{
          background: "var(--amber)",
          color: "#000",
          padding: "10px 14px",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: 600,
          opacity: pending ? 0.7 : 1
        }}
      >
        {pending ? "Saving…" : "Add league"}
      </button>
    </form>
  );
}
