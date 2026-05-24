import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues } from "@/lib/leagues";
import { AddLeagueForm } from "./AddLeagueForm";
import { LeagueList } from "./LeagueList";
import { BackToDashboard } from "@/components/ui/BackToDashboard";

export const dynamic = "force-dynamic";

export default async function LeaguesSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const leagues = await listLeagues(getDb(), session.user.id);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: "32px 24px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <BackToDashboard />
          <Link
            href="/settings/account"
            style={{
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: 12,
              letterSpacing: 0.2,
              border: "1px solid rgba(255,255,255,0.08)",
              padding: "6px 12px",
              borderRadius: 8
            }}
          >
            Account settings →
          </Link>
        </div>
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
    </main>
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  padding: 24,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)"
};

const h2: React.CSSProperties = { color: "var(--cream)", marginTop: 0, fontSize: 16 };
