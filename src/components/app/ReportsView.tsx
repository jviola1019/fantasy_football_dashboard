"use client";

import { useMemo } from "react";
import type { RAEEnvelope } from "@/lib/governance";
import { deriveAppData } from "@/lib/envelope/derive";
import { deriveOutcomeDistribution } from "@/lib/derivedMetrics";
import { reputationEdge } from "@/lib/models";
import { fmt } from "@/lib/utils";
import { PanelGrid, PanelRow } from "@/components/shell/PanelGrid";
import { PanelCard } from "@/components/ui/PanelCard";

/**
 * Weekly / governance report: the season outlook (seeded sim), the full model-
 * governance summary (source, freshness, confidence, validation, assumptions,
 * missing fields), and the reputation-edge leaderboard. Every figure is real or
 * shown as unavailable — no fabricated numbers.
 */
export function ReportsView({ envelope }: { envelope: RAEEnvelope }) {
  const d = useMemo(() => deriveAppData(envelope), [envelope]);
  const dist = useMemo(() => deriveOutcomeDistribution(d.sim), [d.sim]);
  const ss = envelope.sourceState;

  const edges = useMemo(
    () =>
      [...d.players]
        .map((p) => ({ p, e: reputationEdge(p) }))
        .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
        .slice(0, 6),
    [d.players]
  );

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
        <PanelCard id="report-outlook" titleId="ro-title" title="Season Outlook" eyebrow="Seeded Monte-Carlo — reproducible.">
          {d.players.length === 0 ? (
            <p className="muted-note">No roster to simulate — connect a league.</p>
          ) : (
            <>
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
                {d.sim.params.iterations.toLocaleString()} simulations. Outcome odds are conditional on the seeded
                season; the Nexus Multiverse shows P(outcome | wins) in full.
              </p>
            </>
          )}
        </PanelCard>

        <PanelCard id="report-governance" titleId="rg-title" title="Model Governance" eyebrow="Source lineage & assumptions.">
          <dl className="report-gov">
            <div className="report-gov-row"><dt>Mode</dt><dd>{envelope.mode}</dd></div>
            <div className="report-gov-row"><dt>Source</dt><dd>{ss.source}</dd></div>
            <div className="report-gov-row"><dt>Freshness</dt><dd>{ss.freshness}</dd></div>
            <div className="report-gov-row"><dt>Confidence</dt><dd>{(ss.confidence * 100).toFixed(0)}%</dd></div>
            <div className="report-gov-row"><dt>Validation</dt><dd>{ss.validation}</dd></div>
          </dl>
          {ss.assumptions.length > 0 && (
            <>
              <div className="section-label">ASSUMPTIONS</div>
              <ul className="report-assumptions">
                {ss.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          )}
          <div className="section-label">METRICS WITHOUT A FREE SOURCE</div>
          {ss.missingFields.length > 0 ? (
            <p className="report-missing">{ss.missingFields.join(", ")} — rendered as &quot;—&quot;, never invented.</p>
          ) : (
            <p className="muted-note">All shown metrics have a data source.</p>
          )}
        </PanelCard>
      </PanelRow>

      <PanelRow cols={1}>
        <PanelCard id="report-edges" titleId="re-title" title="Reputation Edges" eyebrow="Biggest true-vs-market gaps.">
          {edges.length === 0 ? (
            <p className="muted-note">No players to rank.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
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
