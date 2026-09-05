import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireUser";
import { getDb } from "@/db";
import { getAccountCredentialAge, listLeagues } from "@/lib/leagues";
import { AddLeagueForm } from "./AddLeagueForm";
import { LeagueList } from "./LeagueList";
import { LeagueSettingsForm } from "./LeagueSettingsForm";
import { LeagueIdentityForm } from "./LeagueIdentityForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "League Settings" };

// Rendered inside the (app) shell — the route sidebar + command bar provide
// navigation, so this is just the settings content (no standalone page chrome).
export default async function LeaguesSettingsPage() {
  const user = await requireUser();
  if (!user) redirect("/login");
  const [leagues, espnSignIn] = await Promise.all([
    listLeagues(getDb(), user.id),
    getAccountCredentialAge(getDb(), user.id)
  ]);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gap: 20 }}>
      <header>
        <h1 style={{ color: "var(--cream)", margin: 0, fontSize: "var(--text-xl)" }}>Your leagues</h1>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Sleeper is public. ESPN private leagues need <code>espn_s2</code> and <code>SWID</code> cookies
          from your browser — pasted once for the whole account, not once per league. Cookies are
          encrypted at rest and never sent back to your browser.{" "}
          {espnSignIn ? (
            <>An ESPN sign-in is saved; new ESPN leagues will use it automatically.</>
          ) : (
            <>
              No ESPN sign-in is saved yet. The first ESPN league you add stores one for the account.
            </>
          )}
        </p>
      </header>
      <section style={panel}>
        <h2 style={h2}>Add a league</h2>
        <AddLeagueForm hasAccountEspnSignIn={espnSignIn !== null} />
      </section>
      <section style={panel}>
        <h2 style={h2}>Connected ({leagues.length})</h2>
        <LeagueList leagues={leagues} />
      </section>

      {leagues.map((league) => (
        <section key={league.id} style={panel}>
          <h2 style={h2}>{league.label} — settings</h2>
          <LeagueSettingsForm leagueId={league.id} label={league.label} format={league.settings} />
          <LeagueIdentityForm
            leagueId={league.id}
            label={league.label}
            platform={league.platform}
            sleeperUsername={league.sleeperUsername}
          />
        </section>
      ))}
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  padding: 24,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)"
};

const h2: React.CSSProperties = { color: "var(--cream)", marginTop: 0, fontSize: "var(--text-base)" };
