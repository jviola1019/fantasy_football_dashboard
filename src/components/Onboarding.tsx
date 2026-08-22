import Link from "next/link";

/**
 * Anonymous landing surface (onboarding-first). One primary CTA (Connect a
 * league) + a clear "explore the demo" path, an honest live-vs-demo explainer,
 * and a short capability list. No fabricated numbers — every claim is about what
 * the product does, not invented metrics.
 */
export function Onboarding() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-10 sm:py-16">
      <header className="flex items-baseline gap-3">
        <span className="text-2xl font-extrabold tracking-[0.16em] text-rae-blue">RAE</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Roster Analytics Engine
        </span>
        <Link
          href="/login"
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-rae-blue/50"
        >
          Sign in
        </Link>
      </header>

      <section className="mt-16 max-w-2xl sm:mt-24">
        <h1
          className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl"
          style={{ fontFamily: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif' }}
        >
          Win your league with model-governed, source-traceable analytics.
        </h1>
        <p className="mt-5 text-base leading-relaxed text-muted-foreground">
          RAE turns real Sleeper &amp; ESPN league data, FantasyPros consensus value, nflverse usage, and live
          waiver trends into honest decisions — every number traces to its source, with assumptions and
          confidence shown. No fabricated projections, no black boxes.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-rae-amber px-5 py-3 text-sm font-bold transition-opacity hover:opacity-90"
            // Inline dark text: the global `a { color: inherit }` (unlayered)
            // beats Tailwind's layered text utilities on <a>, so set it directly
            // to keep dark-on-amber well above WCAG AA.
            style={{ color: "#0b1120" }}
          >
            Connect your league
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-rae-blue/50"
          >
            Explore the demo
          </Link>
          <Link
            href="/mock-draft"
            // inline-flex + py-3 gives this tertiary CTA the same 24px+ target
            // height as the two buttons beside it (WCAG 2.2 AA SC 2.5.8); it
            // measured 171x20 before. Kept visually text-only — only the hit
            // area changes, not the emphasis hierarchy.
            className="inline-flex items-center px-1 py-3 text-sm font-semibold text-rae-blue underline-offset-4 hover:underline"
          >
            Mock draft (no account) →
          </Link>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-rae-green">Live</span> = your connected league.{" "}
          <span className="font-semibold text-rae-amber">Demo</span> = a labeled fixture with the real, searchable
          player universe. Data that has no free source is shown as unavailable, never invented.
        </p>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="rounded-xl border border-border bg-card/60 p-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-foreground">{c.title}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-16 text-[11px] text-muted-foreground">
        Real data. Real models. Model-governed decisions.
      </footer>
    </main>
  );
}

const CAPABILITIES: { title: string; body: string }[] = [
  {
    title: "Scarcity gap",
    body: "Find players the market over- or under-prices versus their true value, with the gap and its drivers shown."
  },
  {
    title: "Season simulation",
    body: "A seeded Monte-Carlo season: playoff / championship SCENARIO frequencies shown conditionally on win total, against the league baseline. Reproducible, and openly labeled as not yet validated out of sample."
  },
  {
    title: "Draft & waivers",
    body: "A searchable draft board (every player, recommendations always on-board) and live waiver/hype movement."
  },
  {
    title: "Hype vs. value",
    body: "Sell into the story, buy the dip — real Sleeper waiver trends weighed against true value."
  },
  {
    title: "Roster availability",
    body: "Your roster's real injury / bye flags (out, IR, questionable) ranked by risk — no fabricated severity."
  },
  {
    title: "Governed by design",
    body: "Source, freshness, confidence, validation, and assumptions visible on every view. Nothing is a black box."
  }
];
