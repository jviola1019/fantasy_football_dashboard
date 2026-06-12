import type { CommandMetrics } from "@/lib/derivedMetrics";
import { PanelCard } from "../ui/PanelCard";
import { fmt } from "@/lib/utils";

/**
 * League Health overview tile — the team-state KPI strip extracted verbatim from
 * the former CommandCenter `MetricStrip`. Per-tile data dependencies: when a
 * dependency is in `missingFields`, the tile renders "—" with a "data
 * unavailable" subtitle instead of a number derived from a zeroed field.
 */
export function LeagueHealth({ metrics, missingFields }: { metrics: CommandMetrics; missingFields: string[] }) {
  const missing = new Set(missingFields);
  const trendingUnavailable = missing.has("trending_momentum");
  const chaosUnavailable = missing.has("trending_momentum") || missing.has("opportunity");
  // Both value tiles derive from market_value/true_value; when those are
  // missing the metrics compute over zeroed fields and a "0.0" would read as a
  // real (neutral) edge rather than absent data (UX-10).
  const valuesUnavailable = missing.has("market_value") || missing.has("true_value");

  const cards = [
    valuesUnavailable
      ? { label: "Reputation Edge", value: "—", sub: "Value data unavailable", color: "neu" }
      : {
          label: "Reputation Edge",
          value: fmt(metrics.reputationEdge, 1),
          sub: "Avg True – Market Value",
          color: metrics.reputationEdge >= 0 ? "pos" : "neg"
        },
    valuesUnavailable
      ? { label: "Market Inefficiency", value: "—", sub: "Value data unavailable", color: "neu" }
      : {
          label: "Market Inefficiency",
          value: fmt(metrics.marketInefficiency, 1),
          // marketInefficiency() = confidence-weighted |true − market| mispricing,
          // NOT value-over-replacement — the old sub-label was factually wrong.
          sub: "Avg Market Mispricing",
          color: "neu"
        },
    trendingUnavailable
      ? { label: "Narrative Velocity", value: "—", sub: "Data source not integrated", color: "neu" }
      : {
          label: "Narrative Velocity",
          value: fmt(metrics.narrativeVelocity, 1),
          sub: metrics.narrativeVelocity > 10 ? "High" : metrics.narrativeVelocity > 0 ? "Moderate" : "Low",
          color: metrics.narrativeVelocity >= 0 ? "pos" : "neg"
        },
    {
      label: "League Advantage",
      value: Number.isFinite(metrics.leagueAdvantage) ? `${metrics.leagueAdvantage}%` : "—",
      sub: "vs League Median",
      color: !Number.isFinite(metrics.leagueAdvantage)
        ? "neu"
        : metrics.leagueAdvantage >= 50
          ? "pos"
          : "neg"
    },
    chaosUnavailable
      ? { label: "Chaos Exposure", value: "—", sub: "Data source not integrated", color: "neu" }
      : {
          label: "Chaos Exposure",
          value: `${fmt(metrics.chaosExposure, 0)}/100`,
          sub: metrics.chaosExposure > 50 ? "High" : "Moderate",
          color: metrics.chaosExposure > 60 ? "neg" : "neu"
        }
  ];
  return (
    <PanelCard id="league-health" titleId="lh-title" title="League Health" eyebrow="Your team's state at a glance.">
      <div className="kpi-row">
        {cards.map((c) => (
          <div key={c.label} className={`kpi-card kpi-${c.color}`}>
            <small>{c.label}</small>
            <strong>{c.value}</strong>
            <span>{c.sub}</span>
          </div>
        ))}
      </div>
    </PanelCard>
  );
}
