import { getLatestRankingsSnapshot } from "@/lib/fantasypros/snapshot";
import { fpDataToRecords } from "@/lib/fantasypros/enrich";
import { rankingsSourceFromSnapshot } from "@/lib/leagues/toEnvelope";
import { DraftIntelligence } from "@/components/panels/DraftIntelligence";
import { BackToDashboard } from "@/components/ui/BackToDashboard";
import { SourceFreshnessBadge } from "@/components/governance/SourceFreshnessBadge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock Draft" };

// Standalone pre-draft mock-draft tool. Uses FantasyPros consensus rankings
// directly — no Sleeper league required, no auth required. Lets anyone open
// up a draft board, toggle picks, and watch recommendations + tier collapse
// react in real time. Useful for solo prep ("how does my draft look if I
// take Bijan in round 1?") and for getting reps before a real draft.

export default async function MockDraftPage() {
  const snapshot = await getLatestRankingsSnapshot("PPR");
  if (!snapshot) {
    return (
      <main style={containerStyle}>
        <Header />
        <section style={panelStyle}>
          <h2 style={h2Style}>Rankings not loaded yet</h2>
          <p style={muted}>
            The FantasyPros consensus rankings haven&apos;t been cached yet. The daily
            cron runs at 08:30 UTC; an operator can also trigger it manually via{" "}
            <code>POST /api/cron/rankings-refresh</code> with the <code>CRON_SECRET</code>{" "}
            bearer header. Once it succeeds, refresh this page.
          </p>
        </section>
      </main>
    );
  }

  const source = rankingsSourceFromSnapshot("PPR", snapshot.fetchedAt);
  const records = fpDataToRecords(snapshot.data, source);

  return (
    <main style={containerStyle}>
      <Header
        meta={`${snapshot.data.players.length} players · updated ${snapshot.data.last_updated} · ${snapshot.data.total_experts} experts`}
      />
      <div style={sourceStripStyle} role="status">
        <SourceFreshnessBadge sourceState={source} />
        <span style={{ color: "var(--cream)" }}>
          Consensus rankings — <b>not your league</b>. Recommendations are model-derived from the consensus board.
        </span>
      </div>
      <DraftIntelligence players={records} />
    </main>
  );
}

function Header({ meta }: { meta?: string }) {
  return (
    <header style={headerStyle}>
      <div>
        <h1 style={h1Style}>Mock Draft</h1>
        <p style={muted}>
          {meta ?? "FantasyPros PPR consensus rankings. Toggle picks to update tiers and recommendations."}
        </p>
      </div>
      <BackToDashboard />
    </header>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg)",
  padding: "32px 24px",
  maxWidth: 1280,
  margin: "0 auto"
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 24
};

const h1Style: React.CSSProperties = {
  color: "var(--cream)",
  margin: 0,
  fontSize: "var(--text-2xl)",
  letterSpacing: 0.2
};

const h2Style: React.CSSProperties = {
  color: "var(--cream)",
  marginTop: 0,
  fontSize: "var(--text-lg)"
};

const muted: React.CSSProperties = {
  color: "var(--muted)",
  margin: "8px 0 0",
  fontSize: "var(--text-sm)"
};

const sourceStripStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  margin: "0 0 16px",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(215,168,87,0.22)",
  background: "rgba(43,35,18,0.32)",
  fontSize: "var(--text-sm)"
};

const panelStyle: React.CSSProperties = {
  background: "var(--panel)",
  padding: 24,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)"
};

