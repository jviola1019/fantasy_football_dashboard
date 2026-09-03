"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  buttonStyle,
  destructiveButtonStyle,
  inputStyle,
  labelStyle,
  secondaryButtonStyle
} from "../formStyles";
import { removeEspnSignInAction, saveEspnSignInAction } from "./actions";

export interface EspnCoverageRow {
  leagueId: string;
  label: string;
  origin: "account" | "league-override" | null;
}

/**
 * The ESPN sign-in, stored once for the whole account.
 *
 * WHY IT IS HERE AND NOT ON A LEAGUE. `espn_s2` and `SWID` authenticate an ESPN
 * ACCOUNT — one pair already grants access to every league that account is in.
 * Collecting them per league meant N pastes for N leagues and N edits every time
 * ESPN rotated them, and it degraded silently: update three of four and you get
 * a half-working dashboard with no visible cause.
 *
 * WHAT THIS SCREEN REFUSES TO DO. It never renders the stored cookies, not even
 * masked. A masked secret is still a secret that travelled to a browser, and
 * nothing here needs to read one back — replacing is the only edit, which is
 * also the only operation ESPN's rotation actually calls for.
 *
 * WHAT IT INSISTS ON SAYING. The age, because ESPN cookies expire and age is the
 * only signal a client has; and exactly which leagues the pair covers, so
 * "Remove" states its blast radius instead of asking for a blind confirmation.
 */
export function EspnSignInForm({
  savedAt,
  coverage
}: {
  savedAt: string | null;
  coverage: EspnCoverageRow[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; message?: string }>({
    kind: "idle"
  });
  const [pending, startTransition] = useTransition();
  // With nothing saved there is no state to preserve, so the form is the view.
  const [replacing, setReplacing] = useState(savedAt === null);

  const covered = coverage.filter((c) => c.origin === "account");
  const overridden = coverage.filter((c) => c.origin === "league-override");
  const stranded = coverage.filter((c) => c.origin === null);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setStatus({ kind: "idle" });
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await saveEspnSignInAction(formData);
      if (result.ok) {
        form.reset();
        setReplacing(false);
        setStatus({ kind: "ok", message: result.note ?? "ESPN sign-in saved and verified." });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  const onRemove = () => {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await removeEspnSignInAction();
      if (result.ok) {
        setStatus({
          kind: "ok",
          message:
            covered.length > 0
              ? `Removed. ${leagueCount(covered.length)} will show ESPN data as unavailable until you save a new pair.`
              : "Removed."
        });
        setReplacing(true);
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)" }}>
        {savedAt ? (
          <>
            Saved <strong style={{ color: "var(--cream)" }}>{savedAt}</strong>. Authenticates{" "}
            {leagueCount(covered.length)}
            {overridden.length > 0 ? `; ${overriddenClause(overridden.length)}` : "."}{" "}
            ESPN cookies expire on their own. If ESPN data stops loading, replace them here once and
            every league picks it up.
          </>
        ) : (
          <>
            No ESPN sign-in saved.{" "}
            {stranded.length > 0
              ? `${leagueCount(stranded.length)} currently cannot load ESPN data. `
              : ""}
            One pair authenticates every ESPN league on this account, so you paste these cookies once
            rather than once per league.
          </>
        )}
      </p>

      {covered.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            color: "var(--cream)",
            fontSize: "var(--text-sm)"
          }}
        >
          {covered.map((c) => (
            <li key={c.leagueId}>{c.label}</li>
          ))}
        </ul>
      ) : null}

      {replacing ? (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <p
            id="espn-signin-help"
            style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)" }}
          >
            In a browser signed in to ESPN, open DevTools, then Application, then Cookies, then
            fantasy.espn.com, and copy <code>espn_s2</code> and <code>SWID</code>. RAE cannot sign in
            to ESPN for you: ESPN publishes no OAuth flow and its login is behind a CAPTCHA, so a
            stored password could not be exchanged for a session — it would be a more dangerous
            secret that bought nothing.
          </p>
          <div>
            <label htmlFor="accountEspnS2" style={labelStyle}>
              espn_s2
            </label>
            <input
              id="accountEspnS2"
              name="espnS2"
              type="password"
              autoComplete="off"
              required
              aria-describedby="espn-signin-help"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="accountSwid" style={labelStyle}>
              SWID
            </label>
            <input
              id="accountSwid"
              name="swid"
              type="password"
              autoComplete="off"
              required
              placeholder="{ABCD-1234-...}"
              aria-describedby="espn-signin-help"
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={pending}
              style={{
                ...buttonStyle,
                background: "var(--amber)",
                color: "#000",
                opacity: pending ? 0.7 : 1
              }}
            >
              {pending ? "Checking with ESPN…" : savedAt ? "Replace sign-in" : "Save ESPN sign-in"}
            </button>
            {savedAt ? (
              <button
                type="button"
                onClick={() => {
                  setReplacing(false);
                  setStatus({ kind: "idle" });
                }}
                style={secondaryButtonStyle}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setReplacing(true)} style={secondaryButtonStyle}>
            Replace sign-in
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onRemove}
            style={{ ...destructiveButtonStyle, opacity: pending ? 0.7 : 1 }}
          >
            {pending ? "Removing…" : "Remove sign-in"}
          </button>
        </div>
      )}

      {status.kind === "error" && status.message ? (
        <p
          role="alert"
          aria-live="polite"
          style={{ color: "var(--red, #e35e5e)", margin: 0, fontSize: "var(--text-sm)" }}
        >
          {status.message}
        </p>
      ) : null}
      {status.kind === "ok" && status.message ? (
        <p
          role="status"
          aria-live="polite"
          style={{ color: "var(--green, #6fd07f)", margin: 0, fontSize: "var(--text-sm)" }}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

/** "1 league" / "4 leagues" — the plural is not worth a dependency. */
function leagueCount(n: number): string {
  return n === 1 ? "1 league" : `${n} leagues`;
}

/**
 * The override clause, conjugated.
 *
 * `leagueCount` alone produced "1 league use their own cookies". Interpolating a
 * count into a sentence and hoping the verb agrees is how interface copy ends up
 * reading like it was generated, and this one is on a page whose job is to be
 * trusted with a secret.
 */
function overriddenClause(n: number): string {
  return n === 1
    ? "1 league uses its own cookies instead."
    : `${n} leagues use their own cookies instead.`;
}
