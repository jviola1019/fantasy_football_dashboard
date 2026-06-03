"use client";

import { useState } from "react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs } from "../ui/PanelTabs";
import { DataUnavailable } from "../ui/DataUnavailable";
import {
  deriveNarrativeHalfLife,
  deriveViralVelocity,
  deriveStoryCollisions,
} from "@/lib/derivedMetrics";
import { avg } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
  envelope?: RAEEnvelope;
};

const TABS = ["Narrative Flow", "Impact Over Time", "Collisions", "Sentiment Map"] as const;

export function NarrativeEngine({ players, envelope }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Narrative Flow");
  const halfLife = deriveNarrativeHalfLife(players);
  const viralVel = deriveViralVelocity(players);
  const tone = avg(players.map((p) => p.trendingMomentum)) / 100;
  const collisions = deriveStoryCollisions(players);

  // When the envelope reports trending_momentum is missing (no trending
  // proxy active AND no sentiment adapter integrated), the entire panel is
  // meaningless — every chart and tile derives from trendingMomentum. Show
  // a single banner instead of zeroed visuals.
  const panelState = envelope
    ? derivePanelState(envelope, ["trending_momentum"])
    : { status: "ready" as const, bannerText: null, unavailable: new Set() };

  return (
    <PanelCard
      id="narrative-engine"
      titleId="ne-title"
      title="Narrative Engine"
      eyebrow="Decode stories. Anticipate outcomes."
    >
      {panelState.status === "unavailable" ? (
        <DataUnavailable
          title="Narrative source not integrated"
          description="Story Collisions, Tone, Velocity, and the Sentiment Map require a real news / social-sentiment feed. Without one, every chart in this panel reads zero. Connect a Sleeper league to use the 24-hour trending-adds proxy as a stand-in signal."
        />
      ) : (
        <>
          {panelState.status === "degraded" && panelState.bannerText ? (
            <div
              role="status"
              style={{
                background: "rgba(245,231,196,0.04)",
                border: "1px solid rgba(245,231,196,0.12)",
                color: "var(--cream)",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                marginBottom: 12,
                letterSpacing: 0.2
              }}
            >
              {panelState.bannerText}
            </div>
          ) : null}
          <PanelTabs
            tabs={TABS}
            active={activeTab}
            onSelect={setActiveTab}
            ariaLabel="Narrative Engine tabs"
          />

      {activeTab === "Narrative Flow" && (
        <div className="narrative-layout">
          <NarrativeFlowField players={players} />
          <div className="narrative-metrics">
            <HalfLifeCard halfLife={halfLife} />
            <ToneGauge tone={tone} />
            <VelocityBadge velocity={viralVel} />
          </div>
        </div>
      )}
      {activeTab === "Impact Over Time" && (
        <DataUnavailable
          title="No narrative time-series source"
          description="A real 'impact over time' chart needs dated historical sentiment snapshots. The pipeline only carries a single current trending-momentum value per player, so there is no honest multi-day series to plot. The current snapshot is in the Narrative Flow tab."
        />
      )}
      {activeTab === "Collisions" && (
        <StoryCollisions collisions={collisions} />
      )}
      {activeTab === "Sentiment Map" && (
        <SentimentMap players={players} />
      )}
        </>
      )}
    </PanelCard>
  );
}

function NarrativeFlowField({ players }: { players: PlayerMarketRecord[] }) {
  if (players.length === 0) {
    return <div className="empty-state"><b>No narrative data</b></div>;
  }
  const sorted = [...players].sort(
    (a, b) => Math.abs(b.trendingMomentum) - Math.abs(a.trendingMomentum)
  );
  const maxAbs = Math.max(...sorted.map((p) => Math.abs(p.trendingMomentum)), 1);

  return (
    <div
      className="narrative-flow-svg"
      aria-label="Narrative pressure bar chart — players ranked by narrative impact"
    >
      <div className="narrative-flow-header section-label">NARRATIVE PRESSURE — by player</div>
      <div className="narrative-bar-list narrative-bar-list-padded">
        {sorted.map((p) => {
          const val = p.trendingMomentum;
          const barPct = Math.round((Math.abs(val) / maxAbs) * 100);
          const isPositive = val >= 0;
          return (
            <div key={p.id} className="narrative-bar-row">
              <span className="narrative-bar-row-label" title={p.name}>
                {p.name}
              </span>
              <div className="narrative-bar-track">
                <div
                  role="img"
                  className={`narrative-bar-fill${isPositive ? " narrative-bar-pos" : " narrative-bar-neg"}`}
                  style={{ ["--bar-w" as string]: `${barPct}%` }}
                  aria-label={`${p.name} narrative pressure: ${val}`}
                />
              </div>
              <span className={`narrative-bar-val${isPositive ? " pos-text" : " neg-text"}`}>
                {isPositive ? "+" : ""}{Math.round(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HalfLifeCard({ halfLife }: { halfLife: number }) {
  return (
    <div className="narrative-metric-card">
      <div className="nm-label">NARRATIVE PERSISTENCE</div>
      <div className="nm-value">{Number.isFinite(halfLife) ? halfLife : "—"}</div>
      <div className="nm-sub">Momentum-derived index (0–80; higher = slower decay)</div>
    </div>
  );
}

function ToneGauge({ tone }: { tone: number }) {
  const r = 36;
  const cx = 50;
  const cy = 48;
  const pct = Math.min(1, Math.max(0, (tone + 1) / 2));
  const angle = -180 + pct * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);
  const label = tone > 0.1 ? "Positive" : tone < -0.1 ? "Slightly Negative" : "Neutral";
  return (
    <div className="narrative-metric-card">
      <div className="nm-label">EMOTIONAL TONE</div>
      <svg viewBox="0 4 100 64" width="100%" aria-hidden="true">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="rgba(214,226,226,0.1)" strokeWidth="8" />
        {/* Fill traces the SAME semicircle as the track, ending exactly at the
            needle tip (nx,ny) — so the coloured length is a faithful encoding of
            tone. The previous endpoint formula peeled off the arc. */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${nx} ${ny}`}
          fill="none" stroke={tone >= 0 ? "#77d7b0" : "#d9866f"} strokeWidth="8" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--cream)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="var(--cream)" />
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--cream)" fontWeight="600">
          {Number.isFinite(tone) ? tone.toFixed(2) : "—"}
        </text>
      </svg>
      <div className="nm-sub">{label}</div>
    </div>
  );
}

function VelocityBadge({ velocity }: { velocity: string }) {
  const color = velocity === "High" ? "#77d7b0" : velocity === "Medium" ? "#d7a857" : "#d9866f";
  return (
    <div className="narrative-metric-card">
      <div className="nm-label">VIRAL VELOCITY</div>
      <div className="nm-value" style={{ color }}>{velocity}</div>
      <div className="nm-sub">Current momentum tier</div>
    </div>
  );
}

function StoryCollisions({
  collisions,
}: {
  collisions: ReturnType<typeof deriveStoryCollisions>;
}) {
  return (
    <div className="table-wrap" tabIndex={0}>
      <div className="section-label">MOMENTUM × VOLATILITY FLAGS — heuristic, not detected news</div>
      <table>
        <thead>
          <tr>
            <th>Flag</th>
            <th>Player</th>
            <th>Impact</th>
          </tr>
        </thead>
        <tbody>
          {collisions.length === 0 ? (
            <tr><td colSpan={3}>No players cross the momentum × volatility thresholds.</td></tr>
          ) : (
            collisions.map(({ player, story, impact }) => (
              <tr key={player.id}>
                <td>{story}</td>
                <td>{player.name}</td>
                <td className={impact === "High" ? "pos-text" : "neu-text"}>{impact}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SentimentMap({ players }: { players: PlayerMarketRecord[] }) {
  return (
    <div className="table-wrap" tabIndex={0}>
      <div className="section-label">MARKET-SIGNAL FLAGS — threshold heuristics on market metrics (not detected news)</div>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Fragile</th>
            <th>High Opp.</th>
            <th>Sell Signal</th>
            <th>Overpriced</th>
            <th>Hot</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className={p.fragility > 50 ? "neg-text" : "muted-text"}>{p.fragility > 50 ? "yes" : "—"}</td>
              <td className={p.opportunity > 70 ? "pos-text" : "muted-text"}>{p.opportunity > 70 ? "yes" : "—"}</td>
              <td className={p.ownershipLeverage < -20 ? "neg-text" : "muted-text"}>{p.ownershipLeverage < -20 ? "yes" : "—"}</td>
              <td className={p.perceivedValue > p.trueValue + 10 ? "neg-text" : "muted-text"}>{p.perceivedValue > p.trueValue + 10 ? "yes" : "—"}</td>
              <td className={Math.abs(p.trendingMomentum) > 50 ? "pos-text" : "muted-text"}>{Math.abs(p.trendingMomentum) > 50 ? "yes" : "—"}</td>
            </tr>
          ))}
          {players.length === 0 && (
            <tr><td colSpan={6}>No data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
