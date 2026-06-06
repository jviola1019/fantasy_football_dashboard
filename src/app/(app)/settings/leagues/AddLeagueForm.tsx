"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLeague } from "./actions";

const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  color: "var(--cream)",
  fontSize: 13
};

const label: React.CSSProperties = { color: "var(--muted)", fontSize: 11, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 };

export function AddLeagueForm() {
  const router = useRouter();
  const [platform, setPlatform] = useState<"sleeper" | "espn">("sleeper");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await addLeague(formData);
      if (result.ok) {
        form.reset();
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
          <p id="espn-creds-instructions" style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            In a browser logged into ESPN, open DevTools → Application → Cookies → fantasy.espn.com. Copy <code>espn_s2</code> and <code>SWID</code>.
          </p>
          <div>
            <label htmlFor="espnS2" style={label}>espn_s2</label>
            <input id="espnS2" name="espnS2" type="password" required={platform === "espn"} aria-describedby="espn-creds-instructions" style={input} />
          </div>
          <div>
            <label htmlFor="swid" style={label}>SWID</label>
            <input id="swid" name="swid" type="password" required={platform === "espn"} placeholder="{ABCD-1234-...}" style={input} />
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="sleeperUsername" style={label}>Sleeper username (optional — identifies your team)</label>
          <input id="sleeperUsername" name="sleeperUsername" type="text" placeholder="your Sleeper username" style={input} />
        </div>
      )}
      {error ? <p role="alert" aria-live="polite" style={{ color: "var(--red)", margin: 0, fontSize: 13 }}>{error}</p> : null}
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
