"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import { reputationEdge, marketInefficiency, narrativeVelocity } from "@/lib/models";
import { deriveRisingStars } from "@/lib/derivedMetrics";
import { RadarChart } from "@/components/charts/RadarChart";
import { avg, narrativeLabel, fmt } from "@/lib/utils";
import { mulberry32 } from "@/lib/simulation";

type Props = {
  players: PlayerMarketRecord[];
};

const TABS = ["Universe", "Tiers", "Comparison", "Watchlist", "Projections"] as const;

const STARS = Array.from({ length: 180 }, (_, i) => {
  const rng = mulberry32(i * 7 + 13);
  const rng2 = mulberry32(i * 31 + 7);
  return {
    x: rng() * 100,
    y: rng() * 100,
    r: 0.4 + rng2() * 1.8,
    delay: rng() * 5,
    dur: 2 + rng2() * 4,
  };
});

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
  const reduceMotion = useReducedMotion();
  const cx = 280;
  const cy = 145;

  // Cap visible nodes at 200 by trueValue when crowd is large (~800 players).
  const visible = players.length > 200
    ? [...players].sort((a, b) => b.trueValue - a.trueValue).slice(0, 200)
    : players;

  const nodePos = visible.map((p, i) => {
    const angle = (i / Math.max(visible.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = 65 + p.trueValue * 0.85;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle) * 0.65,
      player: p,
    };
  });

  // Only render team-mate / nearby-value edges to keep edge count reasonable.
  const edgePairs: Array<[number, number]> = [];
  for (let a = 0; a < nodePos.length && edgePairs.length < 120; a++) {
    for (let b = a + 1; b < nodePos.length && edgePairs.length < 120; b++) {
      const sameTeam = nodePos[a].player.team === nodePos[b].player.team;
      const closeValue = Math.abs(nodePos[a].player.trueValue - nodePos[b].player.trueValue) <= 8;
      if (sameTeam || closeValue) edgePairs.push([a, b]);
    }
  }

  return (
    <div className="galaxy-field" aria-label="Galaxy player ecosystem">
      <div className={reduceMotion ? undefined : "galaxy-3d-tilt"}>
        <svg viewBox="0 0 560 290" width="100%" aria-hidden="true">
          <defs>
            <radialGradient id="galaxyCore" cx="50%" cy="50%" r="40%">
              <stop offset="0%" stopColor="rgba(123,183,206,0.22)" />
              <stop offset="60%" stopColor="rgba(155,127,232,0.08)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <filter id="starGlow">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="galaxyNodeGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {STARS.map((s, i) => (
            <circle
              key={i}
              cx={`${s.x}%`}
              cy={`${s.y}%`}
              r={s.r}
              fill="white"
              opacity="0.55"
              className="star"
              style={{ animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
            />
          ))}

          <ellipse cx={cx} cy={cy} rx={240} ry={130} fill="url(#galaxyCore)" />

          {/* Three orbital rings with different stroke styles */}
          {[
            { rx: 70, stroke: "rgba(119,215,176,0.1)", width: "1", dash: undefined },
            { rx: 125, stroke: "rgba(119,215,176,0.22)", width: "1.5", dash: undefined },
            { rx: 185, stroke: "rgba(119,215,176,0.1)", width: "1", dash: "6 10" },
          ].map(({ rx, stroke, width, dash }) => (
            <ellipse
              key={rx}
              cx={cx} cy={cy}
              rx={rx} ry={rx * 0.58}
              fill="none"
              stroke={stroke}
              strokeWidth={width}
              strokeDasharray={dash}
            />
          ))}

          {edgePairs.map(([a, b], i) => (
            <line
              key={`edge-${i}`}
              x1={nodePos[a].x} y1={nodePos[a].y}
              x2={nodePos[b].x} y2={nodePos[b].y}
              stroke="rgba(119,215,176,0.1)"
              strokeWidth="0.7"
            />
          ))}

          {nodePos.map(({ x, y, player }, i) => {
            const isSelected = i === selectedIdx;
            const r = 6 + player.trueValue / 16;
            const color = reputationEdge(player) >= 0 ? "#77d7b0" : "#d9866f";
            return (
              <motion.g
                key={player.id}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(i)}
                animate={reduceMotion ? {} : { scale: [1, 1.05, 1] }}
                transition={{ duration: 4 + i * 0.45, repeat: Infinity }}
              >
                <circle cx={x} cy={y} r={r + 10} fill={color} opacity="0.04" />
                <circle cx={x} cy={y} r={r + 5} fill={color} opacity="0.08" />
                <circle
                  cx={x} cy={y} r={r}
                  fill="rgba(5,8,13,0.92)"
                  stroke={isSelected ? "#d7a857" : color}
                  strokeWidth={isSelected ? "2.5" : "1.4"}
                  filter="url(#galaxyNodeGlow)"
                />
                {isSelected && (
                  <circle cx={x} cy={y} r={r + 4} fill="none" stroke="rgba(215,168,87,0.55)" strokeWidth="1" strokeDasharray="3 3" />
                )}
                {visible.length <= 60 && (
                  <>
                    <text x={x} y={y - r - 5} textAnchor="middle" fontSize="8.5" fill="rgba(232,225,207,0.9)">
                      {player.name.split(" ").pop()}
                    </text>
                    <text x={x} y={y - r - 14} textAnchor="middle" fontSize="7.5" fill="rgba(141,154,160,0.75)">
                      {player.position}
                    </text>
                  </>
                )}
              </motion.g>
            );
          })}

          {visible.length === 0 && (
            <text x={cx} y={cy} textAnchor="middle" fontSize="12" fill="rgba(232,225,207,0.3)">
              No players
            </text>
          )}
        </svg>
      </div>
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
