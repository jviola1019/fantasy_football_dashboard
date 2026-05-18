"use client";

import { useState } from "react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { marketInefficiency, narrativeVelocity } from "@/lib/models";
import { deriveRisingStars } from "@/lib/derivedMetrics";
import { RadarChart } from "@/components/charts/RadarChart";
import { avg, narrativeLabel, fmt } from "@/lib/utils";
import { Canvas3D } from "../three/Canvas3D";
import { PlayerGalaxy } from "../three/scenes/PlayerGalaxy";

type Props = {
  players: PlayerMarketRecord[];
};

const TABS = ["Universe", "Tiers", "Comparison", "Watchlist", "Projections"] as const;

export function PlayerUniverse({ players }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("Universe");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? players.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : players;

  const selected = players[selectedIdx] ?? players[0];
  const risingStars = deriveRisingStars(players);
  const avgIneff = avg(players.map(marketInefficiency));

  return (
    <section className="system-panel panel-universe" id="player-universe" aria-labelledby="pu-title">
      <div className="panel-header-row">
        <div className="panel-title">
          <div className="panel-icon">✦</div>
          <div>
            <h2 id="pu-title">Player Universe</h2>
            <p className="panel-eyebrow">Explore the player ecosystem.</p>
          </div>
        </div>
        <div className="panel-header-controls">
          <select className="galaxy-select" defaultValue="GALAXY VIEW">
            <option>GALAXY VIEW</option>
            <option>ORBITAL VIEW</option>
            <option>TIER VIEW</option>
          </select>
          <input
            className="galaxy-search"
            type="search"
            placeholder="Search players..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search players"
          />
        </div>
      </div>

      <div className="tab-row" role="tablist" aria-label="Player Universe tabs">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            className={`tab-btn${activeTab === t ? " active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="universe-layout">
        <GalaxyView
          players={filtered}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
        />
        <div className="universe-sidebar">
          {selected && <PlayerProfile player={selected} />}
          <UniverseStats
            count={players.length}
            avgIneff={avgIneff}
            risingStars={risingStars}
          />
          {selected && (
            <div className="radar-wrap">
              <div className="section-label">TOP CATEGORIES</div>
              <RadarChart
                axes={[
                  { label: "Value", value: selected.trueValue },
                  { label: "Oppty", value: selected.opportunity },
                  { label: "Narrative", value: Math.abs(selected.narrativePressure) },
                  { label: "Confidence", value: selected.confidence * 100 },
                  { label: "Stability", value: 100 - selected.volatility },
                ]}
                max={100}
                size={140}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function GalaxyView({
  players, selectedIdx, onSelect,
}: {
  players: PlayerMarketRecord[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  const selectedId = players[selectedIdx]?.id ?? null;
  return (
    <div className="galaxy-field" aria-label="3-D galaxy player ecosystem">
      <Canvas3D
        ariaLabel="3-D player galaxy encoding opportunity, true vs perceived value, and confidence"
        height={320}
      >
        <PlayerGalaxy players={players} selectedId={selectedId} />
      </Canvas3D>
      {players.length === 0 ? (
        <div className="galaxy-empty" role="status">No players</div>
      ) : (
        <div className="galaxy-cycler">
          <button type="button" onClick={() => onSelect(Math.max(0, selectedIdx - 1))}>← Prev</button>
          <span>
            {(players[selectedIdx]?.name) ?? "—"} · {selectedIdx + 1}/{players.length}
          </span>
          <button type="button" onClick={() => onSelect(Math.min(players.length - 1, selectedIdx + 1))}>Next →</button>
        </div>
      )}
    </div>
  );
}

function PlayerProfile({ player }: { player: PlayerMarketRecord }) {
  const narrative = narrativeLabel(player.narrativePressure);
  return (
    <div className="player-profile-card">
      <div className="profile-header">
        <div>
          <div className="profile-name">{player.name}</div>
          <div className="profile-pos">{player.position} · {player.team}</div>
        </div>
        <div className="profile-rep">{Math.round(player.trueValue)}</div>
      </div>
      <div className="profile-metrics">
        {[
          ["Reputation Score", player.trueValue],
          ["Market Value", `$${player.perceivedValue}`],
          ["True Value", `$${player.trueValue}`],
        ].map(([k, v]) => (
          <div key={String(k)} className="profile-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
        <div className="profile-row">
          <span>Narrative</span>
          <b className={player.narrativePressure >= 0 ? "pos-text" : "neg-text"}>{narrative}</b>
        </div>
      </div>
      <div className="profile-slot">{player.rosterSlot}</div>
    </div>
  );
}

function UniverseStats({
  count,
  avgIneff,
  risingStars,
}: {
  count: number;
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
          <strong>176</strong>
          <small>Leagues Analyzed</small>
        </div>
        <div className="stat-box">
          <strong>{fmt(avgIneff, 1)}%</strong>
          <small>Avg Inefficiency</small>
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
