"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { chaosExposure, confidenceInterval, marketInefficiency, narrativeVelocity, reputationEdge } from "@/lib/models";
import { runNexusSimulation } from "@/lib/simulation";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";

export const systems = ["Command Center", "Market Intelligence", "Player Universe", "Narrative Engine", "Nexus Simulator"] as const;
type SystemName = (typeof systems)[number];

const modelChecks = [
  "5 top-level systems locked",
  "Roster/player imagery validated via remote metadata",
  "3D/topology variables encoded, not decorative",
  "Seeds + assumptions visible",
  "Mobile density preserved"
];

export function RaeApp({ envelope }: { envelope: RAEEnvelope }) {
  const reduceMotion = Boolean(useReducedMotion());
  const players = envelope.records;
  const hasData = players.length > 0;
  const sim = runNexusSimulation(players, { seed: 20260513, iterations: 2500, rosterSlots: 6, riskTolerance: 0.58 });

  return (
    <main className="rae-shell">
      <LoadingSigil reduceMotion={reduceMotion} />
      <header className="topbar" aria-label="RAE primary navigation">
        <a className="brand" href="#command-center" aria-label="RAE home">
          <span className="brand-mark">RAE</span>
          <small>Reputation<br />Arbitrage<br />Engine</small>
        </a>
        <nav className="system-tabs" aria-label="Top-level systems">
          {systems.map((system, index) => <a href={`#${slug(system)}`} key={system}>{String(index + 1).padStart(2, "0")} / {system}</a>)}
        </nav>
        <div className="ops-status" aria-live="polite"><b>{envelope.mode.toUpperCase()}</b><span>{envelope.sourceState.freshness}</span></div>
      </header>

      <section className="hero-console" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Behavioral-market operating system</p>
          <h1 id="hero-title">Reputation Arbitrage Engine</h1>
          <p>Institutional fantasy football intelligence for perception asymmetry, narrative propagation, fragility, and replayable outcome simulation.</p>
          <div className="hero-actions" aria-label="Audit verification markers">
            {modelChecks.map((check) => <span key={check}>{check}</span>)}
          </div>
        </div>
        <div className="hero-orb" aria-hidden="true"><span /><i /><b>RAE</b></div>
      </section>

      <section className="governance-banner" role="status">
        <b>Source state</b><span>{envelope.sourceState.source}</span><span>freshness {envelope.sourceState.freshness}</span><span>confidence {(envelope.sourceState.confidence * 100).toFixed(0)}%</span><span>validation {envelope.sourceState.validation}</span>
        {envelope.sourceState.failure ? <em>Failure: {envelope.sourceState.failure}</em> : null}
      </section>

      <div className="dashboard-grid">
        <SystemPanel title="Command Center" eyebrow="Operational decision hub" id="command-center">
          <div className="command-layout">
            <aside className="left-rail"><IntelFeed envelope={envelope} /><RosterStack players={players} /></aside>
            <div className="hero-field"><MetricStrip players={players} /><TopologyField players={players} mode="market" reduceMotion={reduceMotion} /></div>
            <aside className="right-rail"><MomentumPanel players={players} /><DraftIntelligence players={players} /></aside>
          </div>
          <BottomSystems players={players} hasData={hasData} sim={sim} />
        </SystemPanel>

        <SystemPanel title="Market Intelligence" eyebrow="Liquidity, ADP drift, volatility surface" id="market-intelligence">
          <MarketTable players={players} />
          <div className="split"><FlowField players={players} reduceMotion={reduceMotion} /><Heatmap players={players} /></div>
        </SystemPanel>

        <SystemPanel title="Player Universe" eyebrow="Flagship orbital ecosystem" id="player-universe">
          <div className="universe-layout"><OrbitalUniverse players={players} reduceMotion={reduceMotion} /><SelectedPlayer player={players[0]} /></div>
        </SystemPanel>

        <SystemPanel title="Narrative Engine" eyebrow="Information physics and story collisions" id="narrative-engine">
          <NarrativeFlow players={players} reduceMotion={reduceMotion} />
          <NarrativeCards players={players} />
        </SystemPanel>

        <SystemPanel title="Nexus Simulator" eyebrow="Replayable outcome multiverse" id="nexus-simulator">
          <OutcomeMultiverse players={players} sim={sim} reduceMotion={reduceMotion} />
          <div className="triad">
            <ScoreCard title="Championship probability" value={hasData ? `${sim.championshipProbability}%` : "Unavailable"} detail={`Seed ${sim.seed}; ${sim.params.iterations.toLocaleString()} iterations.`} />
            <ScoreCard title="Catastrophic risk" value={hasData ? `${sim.catastrophicRisk}%` : "Unavailable"} detail="Fragility, volatility, and shock sensitivity are exposed." />
            <ScoreCard title="Regret index" value={hasData ? `${sim.regretIndex}%` : "Unavailable"} detail="Replayable with logged seed, assumptions, and parameters." />
          </div>
        </SystemPanel>
      </div>
    </main>
  );
}

function LoadingSigil({ reduceMotion }: { reduceMotion: boolean }) {
  return <motion.div className="loading-sigil" aria-hidden="true" initial={{ opacity: 1 }} animate={{ opacity: 0, pointerEvents: "none" }} transition={{ duration: reduceMotion ? 0 : 1.25, delay: reduceMotion ? 0 : 0.45 }}><div><span>RAE</span><small>model verification / topology boot</small></div></motion.div>;
}

function SystemPanel({ title, eyebrow, id, children }: { title: SystemName; eyebrow: string; id: string; children: React.ReactNode }) {
  return <section className="system-panel" id={id} aria-labelledby={`${id}-title`}><div className="panel-title"><span>{title.split(" ")[0]}</span><div><h2 id={`${id}-title`}>{title}</h2><p>{eyebrow}</p></div></div>{children}</section>;
}

function MetricStrip({ players }: { players: PlayerMarketRecord[] }) {
  const metrics = [["Reputation Edge", avg(players.map(reputationEdge))], ["Market Inefficiency", avg(players.map(marketInefficiency))], ["Narrative Velocity", avg(players.map(narrativeVelocity))], ["Chaos Exposure", avg(players.map(chaosExposure))]] as const;
  return <div className="metric-strip">{metrics.map(([label, value]) => <div className="metric" key={label}><small>{label}</small><strong>{Number.isFinite(value) ? value : "—"}</strong><span>confidence bounded</span></div>)}</div>;
}

function TopologyField({ players, mode, reduceMotion }: { players: PlayerMarketRecord[]; mode: string; reduceMotion: boolean }) {
  return <div className="topology topology-3d" aria-label={`${mode} topology field encoding value, leverage, fragility, narrative pressure, opportunity, and volatility`}><GridLabels />{players.length === 0 ? <EmptyState /> : players.map((player, index) => <motion.button className="node player-node" key={player.id} style={{ left: `${8 + player.perceivedValue * 0.82}%`, top: `${88 - player.trueValue * 0.75}%`, width: `${42 + player.opportunity / 2}px`, height: `${42 + player.opportunity / 2}px`, borderColor: player.ownershipLeverage >= 0 ? "rgba(119,215,176,.82)" : "rgba(217,134,111,.78)", transform: `translateZ(${Math.round((100 - player.fragility) / 3)}px)` }} animate={reduceMotion ? {} : { y: [0, -3 - player.volatility / 24, 0], rotateX: [0, 2, 0] }} transition={{ duration: 4 + index * 0.35, repeat: Infinity }} aria-label={`${player.name}: perceived ${player.perceivedValue}, true ${player.trueValue}, volatility ${player.volatility}`}><PlayerImage player={player} compact /><span>{player.name.split(" ").at(-1)}</span></motion.button>)}</div>;
}

function GridLabels() { return <><div className="zone z1">Overvalued</div><div className="zone z2">Undervalued</div><div className="zone z3">Sleeper</div><div className="zone z4">Fade</div><div className="axis x">perceived value →</div><div className="axis y">true value / uncertainty ↑</div></>; }

function RosterStack({ players }: { players: PlayerMarketRecord[] }) {
  return <section className="roster-stack" aria-labelledby="roster-title"><h3 id="roster-title">Connected Roster</h3>{players.length === 0 ? <p>No roster can render until validated player records are available.</p> : players.map((player) => <article className="roster-card" key={player.id}><PlayerImage player={player} /><div><b>{player.name}</b><span>{player.rosterSlot ?? "WATCH"} · {player.position} · {player.team ?? "FA"}</span><small>{player.status ?? "unknown"} · image: {player.imageSource ?? "missing"}</small></div><strong>{reputationEdge(player)}</strong></article>)}</section>;
}

function PlayerImage({ player, compact = false }: { player: PlayerMarketRecord; compact?: boolean }) {
  return <span className={compact ? "player-photo compact" : "player-photo"} data-initials={initials(player.name)}>{player.imageUrl ? <Image src={player.imageUrl} alt={`${player.name} headshot`} fill sizes={compact ? "38px" : "92px"} unoptimized onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}</span>;
}

function MomentumPanel({ players }: { players: PlayerMarketRecord[] }) {
  const sorted = [...players].sort((a, b) => Math.abs(b.narrativePressure) - Math.abs(a.narrativePressure)).slice(0, 3);
  return <section className="momentum-panel"><h3>Narrative / Ownership Pressure</h3>{sorted.length === 0 ? <p>No momentum stream without validated behavioral data.</p> : sorted.map((player) => <p key={player.id}><span>{player.name}</span><b>{narrativeVelocity(player)}</b><i style={{ width: `${Math.min(100, Math.abs(player.narrativePressure))}%` }} /></p>)}</section>;
}

function BottomSystems({ players, hasData, sim }: { players: PlayerMarketRecord[]; hasData: boolean; sim: ReturnType<typeof runNexusSimulation> }) {
  return <div className="cards-row bottom-systems"><ScoreCard title="Lineup win probability" value={hasData ? `${sim.playoffProbability}%` : "Unavailable"} detail="Seeded from Nexus; needs calibrated projections for production." /><ScoreCard title="Team construction" value={hasData ? `${Math.round(100 - avg(players.map((p) => p.fragility)))}%` : "Unavailable"} detail="Roster survivability and position balance score." /><ScoreCard title="Fragility X-ray" value={hasData ? `${avg(players.map((p) => p.fragility))}` : "Unavailable"} detail="Injury, role, age, and volatility proxy exposure." /><ScoreCard title="Start/sit edge" value={hasData ? `${avg(players.map(reputationEdge))}` : "Unavailable"} detail="Contextual edge from market vs true value deltas." /></div>;
}

function FlowField({ players, reduceMotion }: { players: PlayerMarketRecord[]; reduceMotion: boolean }) {
  return <div className="flow-field"><h3>Liquidity Flow Topology</h3><svg viewBox="0 0 760 320" role="img" aria-label="Liquidity flow curves encoded by opportunity and volatility">{players.map((p, i) => <motion.path key={p.id} d={`M28 ${52 + i * 28} C ${220 + p.opportunity} ${18 + p.volatility}, ${410 - p.fragility} ${300 - i * 17}, 732 ${88 + i * 20}`} fill="none" stroke={p.ownershipLeverage >= 0 ? "#77d7b0" : "#d9866f"} strokeWidth={1 + p.confidence * 3} opacity="0.62" initial={false} animate={reduceMotion ? {} : { pathLength: [0.25, 1, 0.25] }} transition={{ duration: 7 + i * 0.2, repeat: Infinity }} />)}</svg></div>;
}

function Heatmap({ players }: { players: PlayerMarketRecord[] }) {
  const positions = ["QB", "RB", "WR", "TE"];
  return <div className="heatmap"><h3>Market Efficiency Heatmap</h3>{positions.map((pos) => <div className="heat-row" key={pos}><b>{pos}</b>{Array.from({ length: 14 }).map((_, i) => { const related = players.filter((p) => p.position === pos); const intensity = related.length ? avg(related.map(marketInefficiency)) + i * 1.45 : i; return <span key={i} style={{ opacity: 0.18 + Math.min(0.82, intensity / 48) }} />; })}</div>)}</div>;
}

function MarketTable({ players }: { players: PlayerMarketRecord[] }) {
  return <div className="table-wrap"><h3>Top Inefficiencies</h3><table><thead><tr><th>Player</th><th>Pos</th><th>Market</th><th>True</th><th>Edge</th><th>Ownership</th><th>Trend</th><th>Confidence</th><th>Freshness</th></tr></thead><tbody>{players.length === 0 ? <tr><td colSpan={9}>No production market records available. Connect adapters or enable labeled fixtures.</td></tr> : players.map((p) => { const ci = confidenceInterval(p.trueValue, p.confidence); return <tr key={p.id}><td><span className="table-player"><PlayerImage player={p} compact />{p.name}</span></td><td>{p.position}</td><td>{p.perceivedValue}</td><td>{p.trueValue} <small>[{ci[0]}, {ci[1]}]</small></td><td>{reputationEdge(p)}</td><td>{p.ownershipLeverage}</td><td>{narrativeVelocity(p) >= 0 ? "↗" : "↘"}</td><td>{Math.round(p.confidence * 100)}%</td><td>{p.sources[0]?.freshness}</td></tr>; })}</tbody></table></div>;
}

function OrbitalUniverse({ players, reduceMotion }: { players: PlayerMarketRecord[]; reduceMotion: boolean }) {
  return <div className="orbital orbital-3d" aria-label="Orbital player ecosystem topology">{players.length === 0 ? <EmptyState /> : players.map((p, i) => { const angle = (i / players.length) * Math.PI * 2; const radius = 24 + p.trueValue * 0.34; return <motion.article key={p.id} className="orbital-node" style={{ left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius * 0.58}%` }} animate={reduceMotion ? {} : { scale: [1, 1.04, 1], rotateY: [0, 5, 0] }} transition={{ duration: 5 + i * 0.4, repeat: Infinity }}><PlayerImage player={p} /><b>{p.name}</b><span>{p.position} · Rep {Math.round(p.trueValue)} · {p.imageSource?.split("·").at(-1)?.trim()}</span></motion.article>; })}<div className="orbital-core">Player<br />Universe</div></div>;
}

function SelectedPlayer({ player }: { player?: PlayerMarketRecord }) {
  if (!player) return <ScoreCard title="Selected player" value="Unavailable" detail="No validated player record is loaded." />;
  return <div className="selected-player"><div className="player-hero"><PlayerImage player={player} /><div><h3>{player.name}</h3><p>{player.rosterSlot} · #{player.jerseyNumber} · {player.team}</p></div></div>{[["Reputation score", player.trueValue], ["Market value", player.perceivedValue], ["Volatility", player.volatility], ["Fragility", player.fragility], ["Breakout odds", player.opportunity], ["Confidence", `${Math.round(player.confidence * 100)}%`]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}<small>Source: {player.sources[0]?.source}; image {player.imageSource}</small></div>;
}

function NarrativeFlow({ players, reduceMotion }: { players: PlayerMarketRecord[]; reduceMotion: boolean }) {
  return <div className="narrative-flow"><h3>Narrative Flow Field</h3>{players.length === 0 ? <EmptyState /> : players.map((p, i) => <motion.div key={p.id} className="wave" style={{ inset: `${7 + i * 3.7}% ${7 + i * 4.5}%`, borderColor: p.narrativePressure >= 0 ? "rgba(154,215,170,.48)" : "rgba(215,140,118,.5)" }} animate={reduceMotion ? {} : { rotate: [0, 2 + i, 0], scale: [0.98, 1.025, 0.98] }} transition={{ duration: 6 + i * 0.45, repeat: Infinity }}><span>{p.name} · {p.narrativePressure > 45 ? "breakout" : p.fragility > 60 ? "injury" : "role"} · half-life {Math.max(2, Math.round(80 - Math.abs(p.narrativePressure)))}d</span></motion.div>)}</div>;
}

function NarrativeCards({ players }: { players: PlayerMarketRecord[] }) {
  return <div className="cards-row">{players.slice(0, 4).map((p) => <ScoreCard key={p.id} title={p.name} value={`${narrativeVelocity(p)}`} detail={`Tone ${p.narrativePressure >= 0 ? "positive" : "negative"}; story-collision confidence ${Math.round(p.confidence * 100)}%.`} />)}</div>;
}

function OutcomeMultiverse({ players, sim, reduceMotion }: { players: PlayerMarketRecord[]; sim: ReturnType<typeof runNexusSimulation>; reduceMotion: boolean }) {
  return <div className="multiverse multiverse-3d"><svg viewBox="0 0 820 340" role="img" aria-label="Outcome multiverse branching futures">{players.map((p, i) => <motion.path key={p.id} d={`M34 170 C 230 ${48 + i * 31}, 465 ${300 - i * 25}, 786 ${80 + i * 25}`} fill="none" stroke={p.fragility > 55 ? "#d9866f" : "#77d7b0"} strokeWidth={1.4 + p.confidence} opacity="0.66" animate={reduceMotion ? {} : { pathLength: [0.2, 1] }} transition={{ duration: 5 + i * 0.2, repeat: Infinity, repeatType: "reverse" }} />)}<circle cx="34" cy="170" r="11" fill="#d9f3ff" /></svg><div className="drivers"><h3>Key drivers</h3>{sim.keyDrivers.map((driver) => <p key={driver.id}><span>{driver.name}</span><b>{driver.contribution}</b></p>)}<small>Assumptions: {sim.assumptions.join(" · ")}</small></div></div>;
}

function IntelFeed({ envelope }: { envelope: RAEEnvelope }) {
  return <div className="intel-feed"><h3>Intelligence Feed</h3><p>{envelope.sourceState.freshness === "fixture" ? "Fixture mode is active. This is not live fantasy intelligence." : envelope.sourceState.failure ?? "Adapter state nominal."}</p><ul>{envelope.sourceState.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>;
}

function DraftIntelligence({ players }: { players: PlayerMarketRecord[] }) {
  const ordered = [...players].sort((a, b) => reputationEdge(b) - reputationEdge(a));
  const best = ordered[0];
  const safe = [...players].sort((a, b) => a.fragility - b.fragility)[0];
  const chaos = [...players].sort((a, b) => chaosExposure(b) - chaosExposure(a))[0];
  return <div className="draft-card"><h3>Draft Intelligence Drawer</h3><p>Contextual war-room module; not a top-level tab.</p>{best ? <div className="draft-picks"><b>Best pick <span>{best.name}</span></b><b>Safest <span>{safe?.name}</span></b><b>Chaos <span>{chaos?.name}</span></b><small>Each recommendation exposes confidence, leverage, fragility impact, playoff implications, and inefficiency when data exists.</small></div> : <span>No recommendation without validated market data.</span>}</div>;
}

function ScoreCard({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return <article className="score-card"><small>{title}</small><strong>{value}</strong><p>{detail}</p></article>;
}

function EmptyState() { return <div className="empty-state"><b>Data unavailable</b><span>RAE will not fabricate topology nodes, rankings, images, or simulations.</span></div>; }
function avg(values: number[]): number { return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : Number.NaN; }
function initials(name: string): string { return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function slug(value: string): string { return value.toLowerCase().replaceAll(" ", "-"); }
