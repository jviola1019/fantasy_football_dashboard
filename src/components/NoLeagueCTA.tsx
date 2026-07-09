import Link from "next/link";

// Full-bleed CTA shown to a signed-in user who has no leagues connected.
// Replaces the silent fixture envelope so users understand why the dashboard
// isn't showing their data. Stays dependency-free (no Framer Motion) for
// initial load — the aesthetic-direction "Aurora gradient" pass can layer
// motion on top later without breaking the contract.

export function NoLeagueCTA() {
  return (
    // <section>, not <main>: this renders INSIDE the app shell's SidebarInset
    // <main>, and landmark rules forbid nested mains (audit 2026-07-08 F-09).
    // min-height uses dvh minus the sticky top bar so the shell doesn't get a
    // second scrollbar.
    <section
      style={{
        minHeight: "calc(100dvh - 96px)",
        background: "var(--bg)",
        color: "var(--cream)",
        display: "grid",
        placeItems: "center",
        padding: "32px 24px",
        position: "relative",
        overflow: "hidden"
      }}
      aria-labelledby="no-league-heading"
    >
      {/* Aurora background — animated via .no-league-aurora in globals.css.
         Composite-path opacity/background-position only; reduced-motion
         collapses it to a static gradient. */}
      <div
        aria-hidden="true"
        className="no-league-aurora"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          maxWidth: 640,
          textAlign: "center",
          position: "relative",
          display: "grid",
          gap: 20
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 11,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "var(--muted)"
          }}
        >
          {"// no league connected"}
        </p>
        <h1
          id="no-league-heading"
          style={{
            margin: 0,
            fontSize: "clamp(28px, 5vw, 44px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1
          }}
        >
          Bring your league.<br />
          <span style={{ color: "var(--amber)" }}>RAE</span> stays demo-mode until you do.
        </h1>
        <p
          style={{
            margin: "0 auto",
            maxWidth: 480,
            fontSize: 15,
            lineHeight: 1.55,
            color: "var(--muted)"
          }}
        >
          Add a Sleeper or ESPN league at <code>/settings/leagues</code> and the dashboard
          will pull your actual roster, overlay FantasyPros consensus rankings, and
          start auditing your league config in real time. No fabricated metrics — what
          you see will be what your league really shows.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 8
          }}
        >
          <Link
            href="/settings/leagues"
            style={{
              padding: "12px 22px",
              background: "var(--amber)",
              color: "#000",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 0.2,
              textDecoration: "none",
              border: "1px solid var(--amber)",
              boxShadow: "0 1px 0 rgba(0,0,0,0.4)"
            }}
          >
            Connect a league →
          </Link>
          <Link
            href="/mock-draft"
            style={{
              padding: "12px 22px",
              background: "transparent",
              color: "var(--cream)",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: 0.2,
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.18)"
            }}
          >
            Try the mock draft instead
          </Link>
        </div>
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: 0.4
          }}
        >
          Account settings · <Link href="/settings/account" style={{ color: "var(--cream)" }}>profile</Link> · <Link href="/login" style={{ color: "var(--cream)" }}>switch accounts</Link>
        </p>
      </div>
    </section>
  );
}
