// Server component: derivation runs on the server (same pattern as RouteView),
// so the seeded sim + bootstrap bands never run on the client. The interactive
// children (tooltips/popovers) stay "use client".
import type { RAEEnvelope } from "@/lib/governance";
import { deriveAppData } from "@/lib/envelope/derive";
import { deriveOutcomeDistribution } from "@/lib/derivedMetrics";
import { scarcityGap } from "@/lib/models";
import { fmt } from "@/lib/utils";
import { PanelGrid, PanelRow } from "@/components/shell/PanelGrid";
import { PanelCard } from "@/components/ui/PanelCard";
import { GovernancePanel } from "@/components/governance/GovernancePanel";
import { ModelScenarioNotice } from "@/components/model/ModelScenarioNotice";
import { AuditInfoTooltip } from "@/components/governance/AuditInfoTooltip";
import { DataLineagePopover } from "@/components/governance/DataLineagePopover";
import { EDGE_LABELS } from "@/lib/models/edgeDisclosure";

/**
 * Weekly / governance report: the season outlook (seeded sim), the full model-
 * governance summary (source, freshness, confidence, validation, assumptions,
 * missing fields), and the scarcity-gap leaderboard. Every figure is real or
 * shown as unavailable — no fabricated numbers.
 */
export function ReportsView({ envelope }: { envelope: RAEEnvelope }) {
  const d = deriveAppData(envelope);
  const dist = deriveOutcomeDistribution(d.sim);

  const edges = [...d.players]
    .map((p) => ({ p, e: scarcityGap(p) }))
    .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
    .slice(0, 6);

  const outcome = [
    { label: "Championship", v: dist.championship },
    { label: "Top 3", v: dist.topThree },
    { label: "Playoffs", v: dist.playoffs },
    { label: "Middle pack", v: dist.middlePack },
    { label: "Bottom 3", v: dist.bottomThree }
  ];

  return (
    <PanelGrid>
      <PanelRow cols={2}>
        <PanelCard
          id="report-outlook"
          titleId="ro-title"
          title="Season Scenario Distribution"
          eyebrow="Seeded Monte-Carlo — reproducible, not validated."
        >
          {d.players.length === 0 ? (
            <p className="muted-note">No roster to simulate — connect a league.</p>
          ) : (
            <>
              {/* Audit 2026-08-20 SS3: unlike the Nexus KPI tiles, the full
                  distribution is retained here. A five-row distribution
                  explicitly labeled as simulated frequency is a legitimate
                  scenario output - the Strategy B demotion targets prominent
                  single-number "probabilities" read as forecasts. The failure
                  notice is still adjacent, and the labels say frequency. */}
              <ModelScenarioNotice variant="banner" />
              <ul className="report-outcome">
                {outcome.map((o) => (
                  <li key={o.label} className="report-outcome-row">
                    <span className="report-outcome-label">{o.label}</span>
                    <span className="report-outcome-track" aria-hidden="true">
                      <span className="report-outcome-fill" style={{ ["--w" as string]: `${Math.max(0, Math.min(100, o.v))}%` }} />
                    </span>
                    <span className="report-outcome-val">{fmt(o.v, 0)}%</span>
                  </li>
                ))}
              </ul>
              <p className="small-note">
                {d.sim.params.iterations.toLocaleString()} simulated seasons. These are simulated{" "}
                <b>frequencies under model assumptions</b>, conditional on the seeded season — not
                forecast probabilities. The Nexus Multiverse shows P(outcome | wins) in full.{" "}
                <AuditInfoTooltip label="Season scenario distribution">
                  Seeded Monte-Carlo (mulberry32) over your roster vs. a league-strength field.
                  Reproducible — same inputs, same output. Reproducibility is not accuracy: this
                  chain failed out-of-sample validation (AUC 0.25, CI [0.13, 0.45] — worse than
                  chance) and is not calibrated. See reports/2026-08-06/backtest-valuation.md.
                </AuditInfoTooltip>
              </p>
            </>
          )}
        </PanelCard>

        <PanelCard id="report-governance" titleId="rg-title" title="Model Governance" eyebrow="Source lineage & assumptions.">
          <GovernancePanel envelope={envelope} />
          <p className="small-note">
            Mode, source, freshness, confidence, validation, and assumptions are carried on every envelope and shown
            on every route — nothing is a black box.
          </p>
        </PanelCard>
      </PanelRow>

      <PanelRow cols={1}>
        <PanelCard id="report-edges" titleId="re-title" title={EDGE_LABELS.panelTitle} eyebrow="Biggest true-vs-market gaps.">
          <p className="small-note">
            Edge = true − market value (adjusted for ownership leverage + fragility).{" "}
            <DataLineagePopover
              metric={EDGE_LABELS.metricName}
              source="FantasyPros consensus (true/market) via scarcityGap()"
              note="Updated by the daily rankings cron; shown as — when rankings are uncached."
            />
          </p>
          {edges.length === 0 ? (
            <p className="muted-note">No players to rank.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Position</th>
                  <th>True</th>
                  <th>Market</th>
                  <th>Edge</th>
                </tr>
              </thead>
              <tbody>
                {edges.map(({ p, e }) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.position}</td>
                    <td>{Math.round(p.trueValue)}</td>
                    <td>{Math.round(p.perceivedValue)}</td>
                    <td className={e >= 0 ? "pos-text" : "neg-text"}>{e >= 0 ? `+${e}` : e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelCard>
      </PanelRow>
    </PanelGrid>
  );
}
