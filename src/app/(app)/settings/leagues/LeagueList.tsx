"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeagueRecord } from "@/lib/leagues";
import { removeLeague } from "./actions";

export function LeagueList({ leagues }: { leagues: LeagueRecord[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (leagues.length === 0) {
    return <p style={{ color: "var(--muted)", margin: 0, marginTop: 12 }}>No leagues connected yet.</p>;
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
      {leagues.map((league) => (
        <li
          key={league.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 12,
            alignItems: "center",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.25)",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.04)"
          }}
        >
          <div>
            <div style={{ color: "var(--cream)", fontWeight: 600 }}>{league.label}</div>
            <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              {league.platform.toUpperCase()} · {league.externalLeagueId} · {league.season}
            </div>
          </div>
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove ${league.label} (${league.platform.toUpperCase()} ${league.season})`}
            onClick={() =>
              startTransition(async () => {
                await removeLeague(league.id);
                router.refresh();
              })
            }
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "var(--muted)",
              padding: "6px 10px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: "var(--text-sm)"
            }}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
