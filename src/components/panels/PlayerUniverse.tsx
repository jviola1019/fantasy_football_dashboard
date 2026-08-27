"use client";

import { useState } from "react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { asMetricSet, type PanelMetricKey } from "@/lib/panelState";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs, TabPanel } from "../ui/PanelTabs";
import { DataUnavailable } from "../ui/DataUnavailable";
import { valuationGap, narrativeVelocity, scarcityGap } from "@/lib/models";
import { EDGE_LABELS } from "@/lib/models/edgeDisclosure";
import { deriveRisingStars } from "@/lib/derivedMetrics";
import { RadarChart } from "@/components/charts/RadarChart";
import { avg, trendingLabel, fmt, surname } from "@/lib/utils";
import { PlayerHeadshot } from "../PlayerHeadshot";
import { fixtureHeadshotFallbacks } from "@/lib/fixtures";
import { selectProjectionForFormat } from "@/lib/leagues/scoringPoints";

type Props = {
  players: PlayerMarketRecord[];
  envelope?: RAEEnvelope;
};

const TABS = ["Universe", "Tiers", "Comparison", "Watchlist", "Projections"] as const;

// Each radar axis maps to the PlayerMarketRecord field it reads. When that
// field is in envelope.sourceState.missingFields the axis renders dashed
// with a "*" footnote (see RadarChart). Confidence + Stability derive from
// rank_std via FantasyPros and are always populated, so they have no dep.
const RADAR_AXIS_DEPS: Array<{ label: string; dep: PanelMetricKey | null }> = [
  { label: "Value", dep: "true_value" },
  { label: "Opportunity", dep: "opportunity" },
  { label: "Trending", dep: "trending_momentum" },
  { label: "Confidence", dep: null },
  { label: "Stability", dep: null }
];

export function PlayerUniverse({ players, envelope }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("Universe");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? players.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : players;

  const selectedBase = players[selectedIdx] ?? players[0];
  // Keep the sidebar in sync with the filtered grid: if a search hides the
  // currently-selected player, show the first visible result instead of a
  // player no longer on screen.
  const selected = searchQuery && selectedBase && !filtered.some((p) => p.id === selectedBase.id)
    ? filtered[0] ?? selectedBase
    : selectedBase;
  const risingStars = deriveRisingStars(players);
  const avgIneff = avg(players.map(valuationGap));
  // Real third stat (replaces the old hardcoded "176 Leagues Analyzed").
  const aboveConsensusCount = players.filter((p) => p.trueValue > p.perceivedValue).length;

  // The universe can be hundreds of players (whole-league pool). Show the top
  // slice by value when browsing; show all matches when searching — so the grid
  // stays fast and readable instead of dumping 600 cards.
  const GRID_CAP = 100;
  const sortedByValue = [...players].sort((a, b) => b.trueValue - a.trueValue);
  // While searching, show EVERY match (a name search rarely exceeds a few dozen);
  // when browsing, show the top GRID_CAP by value with a "search for any" hint.
  const gridPlayers = searchQuery ? filtered : sortedByValue.slice(0, GRID_CAP);

  // O(1) lookup for per-axis dashed rendering. Empty Set when no envelope
  // provided (legacy callers) → all axes treated as available.
  const missing = envelope
    ? asMetricSet(envelope.sourceState.missingFields)
    : new Set<PanelMetricKey>();
  const anyAxisMissing = RADAR_AXIS_DEPS.some((a) => a.dep != null && missing.has(a.dep));

  return (
    <PanelCard
      id="player-universe"
      titleId="pu-title"
      title="Player Universe"
      eyebrow="Explore the player ecosystem."
      controls={
        <input
          className="galaxy-search"
          type="search"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search players"
        />
      }
    >
      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Player Universe tabs"
        idBase="player-universe"
      />

      <TabPanel idBase="player-universe" active={activeTab}>
        {activeTab === "Universe" && (
          <div className="universe-layout">
            <div>
              <GalaxyView
                players={gridPlayers}
                allPlayers={players}
                selectedIdx={selectedIdx}
                onSelect={setSelectedIdx}
              />
              {!searchQuery && players.length > gridPlayers.length ? (
                <p className="small-note pu-grid-note">
                  Showing the top {gridPlayers.length} of {players.length} by value — search to find any player.
                </p>
              ) : null}
            </div>
            <div className="universe-sidebar">
              {selected && <PlayerProfile player={selected} />}
              <UniverseStats
                count={players.length}
                aboveConsensusCount={aboveConsensusCount}
                avgIneff={avgIneff}
                risingStars={risingStars}
              />
              {selected && (
                <div className="radar-wrap">
                  <div className="section-label">METRIC PROFILE</div>
                  <RadarChart
                    axes={[
                      {
                        label: "Value",
                        value: selected.trueValue,
                        unavailable: RADAR_AXIS_DEPS[0]!.dep != null && missing.has(RADAR_AXIS_DEPS[0]!.dep)
                      },
                      {
                        label: "Opportunity",
                        value: selected.opportunity,
                        unavailable: RADAR_AXIS_DEPS[1]!.dep != null && missing.has(RADAR_AXIS_DEPS[1]!.dep)
                      },
                      {
                        // Map signed momentum (−100..100) to a 0..100 position so a
                        // NEGATIVE trend shows a SHORT spoke (consistent with the
                        // signed value in the profile), not |momentum| which made a
                        // −47 look identical to a +47.
                        label: "Trending",
                        value: (selected.trendingMomentum + 100) / 2,
                        unavailable: RADAR_AXIS_DEPS[2]!.dep != null && missing.has(RADAR_AXIS_DEPS[2]!.dep)
                      },
                      { label: "Confidence", value: selected.confidence * 100 },
                      { label: "Stability", value: 100 - selected.volatility },
                    ]}
                    max={100}
                    size={140}
                  />
                  {anyAxisMissing ? (
                    <p className="small-note pu-radar-note">
                      Axes marked <code>*</code> have no integrated data source yet — radar polygon
                      drops to 0 on those edges rather than show a fabricated reading.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "Tiers" && <UniverseTiers players={players} />}
        {activeTab === "Comparison" && <UniverseComparison player={selected} players={players} />}
        {activeTab === "Watchlist" && (
          <UniverseWatchlist players={players} trendingUnavailable={missing.has("trending_momentum")} />
        )}
        {activeTab === "Projections" && <UniverseProjections envelope={envelope} players={players} />}
      </TabPanel>
    </PanelCard>
  );
}

function GalaxyView({
  players,
  allPlayers,
  selectedIdx,
  onSelect,
}: {
  players: PlayerMarketRecord[];
  allPlayers: PlayerMarketRecord[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  const maxVal = Math.max(...allPlayers.map((p) => p.trueValue), 1);

  if (players.length === 0) {
    return <div className="player-grid-empty" role="status">No players found</div>;
  }

  return (
    <div role="region" aria-label="Player grid">
      <div className="player-grid">
        {players.map((p) => {
          const originalIdx = allPlayers.findIndex((ap) => ap.id === p.id);
          const isSelected = selectedIdx === originalIdx;
          return (
            <button
              key={p.id}
              type="button"
              className={`player-grid-card${isSelected ? " selected" : ""}`}
              onClick={() => originalIdx !== -1 && onSelect(originalIdx)}
              aria-pressed={isSelected}
              aria-label={`${p.name}, ${p.position}, ${p.team ?? "unknown team"}`}
            >
              <div className="player-grid-card-header">
                <PlayerHeadshot
                  player={p}
                  fallbacks={fixtureHeadshotFallbacks[p.id] ?? []}
                  size={36}
                />
                <div className="player-grid-card-text">
                  <div className="player-grid-card-name">{p.name}</div>
                  <div className="player-grid-card-meta">{p.position} · {p.team ?? "—"}</div>
                </div>
              </div>
              <div className="player-grid-card-value">{Math.round(p.trueValue)}</div>
              <div className="player-row-bar-wrap" aria-hidden="true">
                <div
                  className="player-row-bar"
                  style={{ ["--bar-w" as string]: `${Math.round((p.trueValue / maxVal) * 100)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerProfile({ player }: { player: PlayerMarketRecord }) {
  const trending = trendingLabel(player.trendingMomentum);
  return (
    <div className="player-profile-card">
      <div className="profile-header">
        <div className="profile-id-row">
          <PlayerHeadshot
            player={player}
            fallbacks={fixtureHeadshotFallbacks[player.id] ?? []}
            size={44}
          />
          <div>
            <div className="profile-name">{player.name}</div>
            <div className="profile-pos">{player.position} · {player.team}</div>
          </div>
        </div>
        <div className="profile-rep">{Math.round(player.trueValue)}</div>
      </div>
      <div className="profile-metrics">
        {[
          // Distinct quantities (unitless 0-100 ECR scores; edge is true−market).
          // "True Value" here is the SAME number shown across every panel.
          ["True Value", Math.round(player.trueValue)],
          ["Market Value", Math.round(player.perceivedValue)],
          ["Edge", Math.round(scarcityGap(player))],
        ].map(([k, v]) => (
          <div key={String(k)} className="profile-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
        <div className="profile-row">
          <span>Trending</span>
          <b className={player.trendingMomentum >= 0 ? "pos-text" : "neg-text"}>{trending}</b>
        </div>
      </div>
      <div className="profile-slot">{player.rosterSlot ?? "—"}</div>
    </div>
  );
}

function UniverseStats({
  count,
  aboveConsensusCount,
  avgIneff,
  risingStars,
}: {
  count: number;
  aboveConsensusCount: number;
  avgIneff: number;
  risingStars: PlayerMarketRecord[];
}) {
  return (
    <div className="universe-stats">
      <div className="section-label">UNIVERSE STATS</div>
      <div className="stats-row">
        <div className="stat-box">
          <strong>{count}</strong>
          <small>Total Players</small>
        </div>
        <div className="stat-box">
          <strong>{aboveConsensusCount}</strong>
          <small>{EDGE_LABELS.aboveConsensus}</small>
        </div>
        <div className="stat-box">
          <strong>{fmt(avgIneff, 1)}</strong>
          <small>{EDGE_LABELS.avgGapStat}</small>
        </div>
      </div>
      <div className="section-label mt8">RISING STARS</div>
      <ul className="rising-list">
        {risingStars.map((p) => (
          <li key={p.id} className="rising-item">
            <span>{p.name}</span>
            <span className={narrativeVelocity(p) >= 0 ? "pos-text" : "neg-text"}>
              {narrativeVelocity(p) >= 0 ? "+" : ""}{Math.round(narrativeVelocity(p))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Tab: Tiers — value bands per position ─────────────────────────────────────
const TIER_BANDS: Array<{ label: string; min: number }> = [
  { label: "Elite", min: 85 },
  { label: "Tier 1", min: 70 },
  { label: "Tier 2", min: 55 },
  { label: "Tier 3", min: 40 },
  { label: "Deep", min: 0 }
];
const TIER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

function UniverseTiers({ players }: { players: PlayerMarketRecord[] }) {
  return (
    <div className="universe-tiers">
      <div className="section-label">VALUE TIERS BY POSITION</div>
      {TIER_POSITIONS.map((pos) => {
        const atPos = players.filter((p) => p.position === pos).sort((a, b) => b.trueValue - a.trueValue);
        if (atPos.length === 0) return null;
        return (
          <div key={pos} className="tier-pos-block">
            <div className="tier-pos-head">{pos}</div>
            {TIER_BANDS.map((band, i) => {
              const max = i === 0 ? Infinity : TIER_BANDS[i - 1]!.min;
              const inBand = atPos.filter((p) => p.trueValue >= band.min && p.trueValue < max).slice(0, 8);
              if (inBand.length === 0) return null;
              return (
                <div key={band.label} className="tier-band-row">
                  <span className="tier-band-label">{band.label}</span>
                  <span className="tier-band-players">
                    {inBand.map((p) => (
                      <span key={p.id} className="tier-chip">
                        {surname(p.name)} <b>{Math.round(p.trueValue)}</b>
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Comparison — selected player vs its positional peers ──────────────────
function UniverseComparison({ player, players }: { player?: PlayerMarketRecord; players: PlayerMarketRecord[] }) {
  if (!player) {
    return <p className="muted-note">Select a player in the Universe tab to compare against positional peers.</p>;
  }
  const peers = players
    .filter((p) => p.position === player.position)
    .sort((a, b) => b.trueValue - a.trueValue)
    .slice(0, 6);
  const rows = peers.some((p) => p.id === player.id) ? peers : [player, ...peers].slice(0, 6);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Player comparison table">
      <div className="section-label">COMPARISON — {player.name} vs {player.position} peers</div>
      <table>
        <thead>
          <tr><th>Player</th><th>True</th><th>Market</th><th>Edge</th><th>Trend</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            // Same Edge formula as every other panel (scarcityGap), so a
            // player's Edge is identical here and in Market Intelligence/Waiver.
            const edge = Math.round(scarcityGap(p));
            return (
              <tr key={p.id} className={p.id === player.id ? "cmp-self" : undefined}>
                <td>
                  {p.name}
                  {p.id === player.id ? (
                    <>
                      <span aria-hidden="true"> ◂</span>
                      <span className="sr-only"> (selected)</span>
                    </>
                  ) : null}
                </td>
                <td>{Math.round(p.trueValue)}</td>
                <td>{Math.round(p.perceivedValue)}</td>
                <td className={edge >= 0 ? "pos-text" : "neg-text"}>{edge >= 0 ? `+${edge}` : edge}</td>
                <td>{p.trendingMomentum > 0 ? "↗" : p.trendingMomentum < 0 ? "↘" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Watchlist — biggest risers / fallers by narrative velocity ───────────
function UniverseWatchlist({ players, trendingUnavailable }: { players: PlayerMarketRecord[]; trendingUnavailable: boolean }) {
  if (trendingUnavailable) {
    return (
      <DataUnavailable
        title="Watchlist needs a momentum source"
        description="Risers/fallers rank by trending momentum, which has no integrated source for this envelope yet. Connect a Sleeper league (trending adds/drops) or wait for the news-velocity cron."
      />
    );
  }
  const byVel = [...players].sort((a, b) => narrativeVelocity(b) - narrativeVelocity(a));
  const risers = byVel.slice(0, 8);
  const fallers = byVel.slice(-8).reverse();
  const col = (title: string, list: PlayerMarketRecord[]) => (
    <div className="watch-col">
      <div className="section-label">{title}</div>
      <ul className="rising-list">
        {list.map((p) => (
          <li key={p.id} className="rising-item">
            <span>{p.name}</span>
            <span className={narrativeVelocity(p) >= 0 ? "pos-text" : "neg-text"}>
              {narrativeVelocity(p) >= 0 ? "+" : ""}{Math.round(narrativeVelocity(p))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return <div className="watch-cols">{col("TOP RISERS", risers)}{col("TOP FALLERS", fallers)}</div>;
}

// ── Tab: Projections — weekly pts when the cron has them, else honest empty ────
function UniverseProjections({ envelope, players }: { envelope?: RAEEnvelope; players: PlayerMarketRecord[] }) {
  const proj = envelope?.weeklyProjections ?? null;
  const meta = envelope?.weeklyProjectionsMeta ?? null;
  if (!proj || Object.keys(proj).length === 0) {
    return (
      <DataUnavailable
        title="No weekly projections yet"
        description="Sleeper weekly point projections populate during the regular season (via the projections cron). Off-season or pre-cron, there is nothing real to rank here."
      />
    );
  }
  // Audit 2026-08-20 §7: the projection record carries all three scoring
  // variants, so the unit shown here is chosen from the league's OWN format and
  // named in the column header. A player with no projection in that unit is
  // omitted rather than shown in a different unit, and the omission is disclosed
  // instead of hidden.
  const scoring = envelope?.leagueFormat?.scoringFormat ?? "PPR";
  const scored = players
    .map((p) => {
      // Keyed by the namespaced record id (audit 2026-08-20 §7b) — no stripping.
      const raw = proj[p.id];
      const sel = raw ? selectProjectionForFormat(raw, scoring) : null;
      return sel ? { p, pts: sel.points, substituted: sel.substituted } : null;
    })
    .filter((r): r is { p: PlayerMarketRecord; pts: number; substituted: boolean } => r != null);
  const ranked = [...scored].sort((a, b) => b.pts - a.pts).slice(0, 25);
  const omitted = players.length - scored.length;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Weekly projections table">
      <div className="section-label">
        WEEKLY PROJECTIONS{meta ? ` — week ${meta.week}, ${meta.season}` : ""} — {scoring} SCORING
      </div>
      {ranked.length === 0 ? (
        <p className="muted-note">No projected players in this set.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Position</th>
                <th>Projected pts ({scoring})</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ p, pts }) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.position}</td><td><b>{pts.toFixed(1)}</b></td></tr>
              ))}
            </tbody>
          </table>
          {omitted > 0 ? (
            <p className="muted-note">
              {omitted} player{omitted === 1 ? "" : "s"} in this set have no projection in {scoring}
              {" "}scoring and are omitted rather than shown in a different unit.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
