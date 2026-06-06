import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues } from "@/lib/leagues";
import { AddLeagueForm } from "./AddLeagueForm";
import { LeagueList } from "./LeagueList";

export const dynamic = "force-dynamic";

// Rendered inside the (app) shell — the route sidebar + command bar provide
// navigation, so this is just the settings content (no standalone page chrome).
export default async function LeaguesSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const leagues = await listLeagues(getDb(), session.user.id);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gap: 20 }}>
      <header>
        <h1 style={{ color: "var(--cream)", margin: 0, fontSize: 24 }}>Your leagues</h1>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Sleeper is public. ESPN private leagues require <code>espn_s2</code> and <code>SWID</code> cookies
          from your browser. Cookies are encrypted at rest and never sent back to your browser after creation.
        </p>
      </header>
      <section style={panel}>
        <h2 style={h2}>Add a league</h2>
        <AddLeagueForm />
      </section>
      <section style={panel}>
        <h2 style={h2}>Connected ({leagues.length})</h2>
        <LeagueList leagues={leagues} />
      </section>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  padding: 24,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)"
};

const h2: React.CSSProperties = { color: "var(--cream)", marginTop: 0, fontSize: 16 };
