import Link from "next/link";
import { evidenceLedger, VERDICT_LABEL, type Verdict } from "./onboarding/evidenceLedger";

/**
 * Anonymous landing surface.
 *
 * WHAT THIS REPLACED, AND WHY (design review §1, open since 2026-08-14).
 *
 * Six equal cards in a 2×3 grid, each a title and two lines of prose. The
 * problem was not that the copy was wrong — it was that six boxes of identical
 * weight rank nothing, so a reader had to read all six to find out which claim
 * the product could actually stand behind. That is the same defect the type
 * audit found inside the app, in a different medium: uniform emphasis is the
 * absence of hierarchy, and the honest content was there and simply not ranked.
 *
 * The replacement is the argument this product can make and its competitors
 * cannot: a LEDGER of what has been tested, ordered by verdict, ending with the
 * thesis RAE was named after and abandoned when a frozen holdout refuted it.
 * The numbers are read from the model modules (`evidenceLedger.ts`), so this
 * page cannot drift from what the product actually measured — a hand-typed
 * "18.5% Brier skill" on a page about not fabricating numbers would be the
 * exact failure it advertises against.
 *
 * Numbering is deliberate and load-bearing: the rows are a ranking by strength
 * of evidence, so the order carries information. Where it does not — the "what
 * you get" list below — there are no numbers.
 */
const VERDICT_CLASS: Record<Verdict, string> = {
  validated: "ledger-row is-validated",
  reproducible: "ledger-row is-reproducible",
  refuted: "ledger-row is-refuted"
};

export function Onboarding() {
  const ledger = evidenceLedger();

  return (
    <main className="landing">
      <header className="landing-bar">
        <span className="landing-mark">RAE</span>
        <span className="landing-mark-sub">Roster Analytics Engine</span>
        <Link href="/login" className="landing-signin">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <p className="landing-eyebrow">Model governance for a fantasy roster</p>
        <h1 className="landing-title">
          Most fantasy tools tell you what they found.
          <br />
          <em>This one also tells you what it looked for and did not.</em>
        </h1>
        <p className="landing-lede">
          RAE reads your real Sleeper or ESPN league, FantasyPros consensus, nflverse usage and live
          waiver movement, and puts a source, a freshness stamp, a confidence and a validation state
          on every number it shows you. Where there is no free source, it says unavailable instead of
          inventing one.
        </p>

        <div className="landing-actions">
          <Link href="/login" className="landing-cta">
            Connect your league
          </Link>
          <Link href="/dashboard" className="landing-secondary">
            Explore the demo
          </Link>
          <Link href="/mock-draft" className="landing-tertiary">
            Mock draft, no account →
          </Link>
        </div>

        <p className="landing-modes">
          <b className="mode-live">Live</b> is your connected league.{" "}
          <b className="mode-demo">Demo</b> is a labelled fixture over the real, searchable player
          universe. Both are marked on every screen.
        </p>
      </section>

      <section className="landing-ledger" aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="landing-section-title">
          What has been tested, and how it went
        </h2>
        <p className="landing-section-lede">
          Ordered by the strength of the evidence behind it. Every figure is read from the model that
          produces it, and every row names a file you can open.
        </p>

        {/* `role="list"` is not redundant here. `.ledger` sets
            `list-style: none`, which makes Safari/VoiceOver drop list
            semantics — and the index is `aria-hidden`, so the ranking this
            page calls load-bearing would then be conveyed by nothing at all. */}
        <ol className="ledger" role="list">
          {ledger.map((row, i) => (
            <li key={row.subject} className={VERDICT_CLASS[row.verdict]}>
              <span className="ledger-index" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              {/* Split into WHAT and WHY so the ledger reads as a ledger at
                  desktop width: verdict, subject and the measured figure in a
                  narrow left column; the claim, the protocol and the evidence
                  path in a wider right one. Below 1040px they stack, because a
                  22ch column of headings beside a 68ch column of prose is a
                  table on a phone. */}
              <div className="ledger-head">
                <p className="ledger-verdict">{VERDICT_LABEL[row.verdict]}</p>
                <h3 className="ledger-subject">{row.subject}</h3>
                <p className="ledger-measurement">{row.measurement}</p>
              </div>
              <div className="ledger-detail">
                <p className="ledger-claim">{row.claim}</p>
                <p className="ledger-protocol">{row.protocol}</p>
                <p className="ledger-evidence">Evidence: {row.evidence}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-what" aria-labelledby="what-heading">
        <h2 id="what-heading" className="landing-section-title">
          What you actually get
        </h2>
        {/* No numbering here: these are simultaneous surfaces, not a sequence,
            and numbering them would assert an order that does not exist. */}
        <ul className="what-list">
          {SURFACES.map((s) => (
            <li key={s.title}>
              <b>{s.title}</b> — {s.body}
            </li>
          ))}
        </ul>
      </section>

      <footer className="landing-foot">
        Real sources. Measured models. Everything it cannot show, it names.
      </footer>
    </main>
  );
}

/**
 * The surfaces, described by what they do rather than by what they promise.
 *
 * The scarcity wording is careful and stays careful: protocol 3 tested that
 * quantity on 115 real drafts and found that WITHIN a position it did worse
 * than chance, so this copy may describe the distance from consensus and may
 * not suggest the distance locates a bargain. `e2e/20` bans the stems outright
 * on this route, with no negation allowance, and that is the right setting for
 * a marketing surface.
 */
const SURFACES: { title: string; body: string }[] = [
  {
    title: "Draft board",
    body: "Every player, searchable, with recommendations always on the board rather than hidden behind a tab — plus bye weeks and tier collapse."
  },
  {
    title: "Waiver wire",
    body: "Free agents ranked by value, observed usage and positional scarcity, with league-wide FAAB where the league actually bids money."
  },
  {
    title: "Weekly start/sit",
    body: "The measured probability each player clears their position's start line, with the reliability diagram it was measured from one click away."
  },
  {
    title: "Trades",
    body: "Real market values from FantasyCalc, KeepTradeCut and DynastyProcess, evaluated against your league's own scoring and roster shape."
  },
  {
    title: "Positional scarcity",
    body: "How far each player sits from consensus and what drives the gap. It measures scarcity at a position, not a market error — and the product says so where the number appears."
  },
  {
    title: "Governance, everywhere",
    body: "Source, freshness, confidence, validation state and assumptions on every panel. Stale is labelled stale; a fixture is labelled a fixture."
  }
];
