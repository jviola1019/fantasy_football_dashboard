"use client";

import { motion, useReducedMotion } from "framer-motion";
import { confidenceInterval, marketInefficiency, narrativeVelocity, reputationEdge, chaosExposure } from "@/lib/models";
import { runNexusSimulation } from "@/lib/simulation";
import type { RAEEnvelope, PlayerMarketRecord } from "@/lib/governance";

const systems = ["Command Center", "Market Intelligence", "Player Universe", "Narrative Engine", "Nexus Simulator"] as const;

type SystemName = (typeof systems)[number];

export function RaeApp({ envelope }: { envelope: RAEEnvelope }) {
  const reduceMotion = useReducedMotion();
  const players = envelope.records;
  const sim = runNexusSimulation(players, { seed: 20260513, iterations: 2500, rosterSlots: 6, riskTolerance: 0.58 });
  const hasData = players.length > 0;

  return (
    <main className="rae-shell">
      <header className="topbar" aria-label="RAE primary navigation">
        <div className="brand"><span>RAE</span><small>Reputation<br />Arbitrage<br />Engine</small></div>
        <nav className="system-tabs" aria-label="Top-level systems">
          {systems.map((system, index) => <a href={`#${slug(system)}`} key={system}>{index + 1}. {system}</a>)}
        </nav>
        <div className="ops-status" aria-live="polite"><b>{envelope.mode.toUpperCase()}</b><span>{envelope.sourceState.freshness}</span></div>
      </header>

      <section className="governance-banner" role="status">
        <b>Source state:</b> {envelope.sourceState.source} · freshness {envelope.sourceState.freshness} · confidence {(envelope.sourceState.confidence * 100).toFixed(0)}% · validation {envelope.sourceState.validation}.
        {envelope.sourceState.failure ? <span> Failure: {envelope.sourceState.failure}</span> : null}
      </section>

      <div className="dashboard-grid">
        <SystemPanel title="Command Center" eyebrow="Operational decision hub" id="command-center">
          <MetricStrip players={players} />
          <TopologyField players={players} mode="market" reduceMotion={Boolean(reduceMotion)} />
          <div className="triad">
            <IntelFeed envelope={envelope} />
            <ScoreCard title="Lineup win probability" value={hasData ? `${sim.playoffProbability}%` : "Unavailable"} detail="Seeded from Nexus scenario; requires calibrated projections for production." />
            <DraftIntelligence players={players} />
          </div>
        </SystemPanel>

        <SystemPanel title="Market Intelligence" eyebrow="Detect dislocations" id="market-intelligence">
          <MarketTable players={players} />
          <div className="split">
            <FlowField players={players} reduceMotion={Boolean(reduceMotion)} />
            <Heatmap players={players} />
          </div>
        </SystemPanel>

        <SystemPanel title="Player Universe" eyebrow="Orbital player ecosystem" id="player-universe">
          <OrbitalUniverse players={players} reduceMotion={Boolean(reduceMotion)} />
          <SelectedPlayer player={players[0]} />
        </SystemPanel>

        <SystemPanel title="Narrative Engine" eyebrow="Information propagation" id="narrative-engine">
          <NarrativeFlow players={players} reduceMotion={Boolean(reduceMotion)} />
          <NarrativeCards players={players} />
        </SystemPanel>

        <SystemPanel title="Nexus Simulator" eyebrow="Outcome multiverse" id="nexus-simulator">
          <OutcomeMultiverse players={players} sim={sim} reduceMotion={Boolean(reduceMotion)} />
          <div className="triad">
            <ScoreCard title="Championship probability" value={hasData ? `${sim.championshipProbability}%` : "Unavailable"} detail={`Seed ${sim.seed}; ${sim.params.iterations.toLocaleString()} iterations.`} />
            <ScoreCard title="Catastrophic risk" value={hasData ? `${sim.catastrophicRisk}%` : "Unavailable"} detail="Exposes fragility and volatility shock sensitivity." />
            <ScoreCard title="Regret index" value={hasData ? `${sim.regretIndex}%` : "Unavailable"} detail="Scenario replayable with the logged seed and parameters." />
          </div>
        </SystemPanel>
      </div>
    </main>
  );
}

function SystemPanel({ title, eyebrow, id, children }: { title: SystemName; eyebrow: string; id: string; children: React.ReactNode }) {
  return <section className="system-panel" id={id} aria-labelledby={`${id}-title`}><div className="panel-title"><span>{title.split(" ")[0]}</span><div><h2 id={`${id}-title`}>{title}</h2><p>{eyebrow}</p></div></div>{children}</section>;
}

function MetricStrip({ players }: { players: PlayerMarketRecord[] }) {
  const avgEdge = avg(players.map(reputationEdge));
  const avgIneff = avg(players.map(marketInefficiency));
  const avgNarrative = avg(players.map(narrativeVelocity));
  const avgChaos = avg(players.map(chaosExposure));
  return <div className="metric-strip">{[["Reputation Edge", avgEdge], ["Market Inefficiency", avgIneff], ["Narrative Velocity", avgNarrative], ["Chaos Exposure", avgChaos]].map(([label, value]) => <div className="metric" key={label}><small>{label}</small><strong>{Number.isFinite(value as number) ? value : "—"}</strong><span>confidence-bounded</span></div>)}</div>;
}

function TopologyField({ players, mode, reduceMotion }: { players: PlayerMarketRecord[]; mode: string; reduceMotion: boolean }) {
  return <div className="topology" aria-label={`${mode} topology field encoding value, leverage, fragility, narrative pressure, opportunity, and volatility`}><div className="zone z1">Overvalued</div><div className="zone z2">Undervalued</div><div className="zone z3">Sleeper</div><div className="zone z4">Fade</div>{players.length === 0 ? <EmptyState /> : players.map((player, index) => <motion.button className="node" key={player.id} style={{ left: `${8 + player.perceivedValue * 0.82}%`, top: `${88 - player.trueValue * 0.75}%`, width: `${18 + player.opportunity / 3}px`, height: `${18 + player.opportunity / 3}px`, borderColor: player.ownershipLeverage >= 0 ? "#9fd7aa" : "#d78c76" }} animate={reduceMotion ? {} : { y: [0, -4 - player.volatility / 18, 0] }} transition={{ duration: 4 + index * 0.3, repeat: Infinity, ease: "easeInOut" }} title={`${player.name}: edge ${reputationEdge(player)}`}><span>{player.name.split(" ").map((part) => part[0]).join("")}</span></motion.button>)}</div>;
}

function FlowField({ players, reduceMotion }: { players: PlayerMarketRecord[]; reduceMotion: boolean }) {
  return <div className="flow-field"><h3>Liquidity Flow Topology</h3><svg viewBox="0 0 640 260" role="img" aria-label="Liquidity flow curves encoded by opportunity and volatility">{players.map((p, i) => <motion.path key={p.id} d={`M20 ${40 + i * 24} C ${180 + p.opportunity} ${10 + p.volatility}, ${340 - p.fragility} ${250 - i * 16}, 620 ${70 + i * 18}`} fill="none" stroke={p.ownershipLeverage >= 0 ? "#77d7b0" : "#d9866f"} strokeWidth={1 + p.confidence * 2} opacity="0.55" initial={false} animate={reduceMotion ? {} : { pathLength: [0.35, 1, 0.35] }} transition={{ duration: 8, repeat: Infinity }} />)}</svg></div>;
}

function Heatmap({ players }: { players: PlayerMarketRecord[] }) {
  const positions = ["QB", "RB", "WR", "TE"];
  return <div className="heatmap"><h3>Market Efficiency Heatmap</h3>{positions.map((pos) => <div className="heat-row" key={pos}><b>{pos}</b>{Array.from({ length: 12 }).map((_, i) => { const related = players.filter((p) => p.position === pos); const intensity = related.length ? avg(related.map(marketInefficiency)) + i * 1.6 : i; return <span key={i} style={{ opacity: 0.2 + Math.min(0.8, intensity / 45) }} />; })}</div>)}</div>;
}

function MarketTable({ players }: { players: PlayerMarketRecord[] }) {
  return <div className="table-wrap"><h3>Top Inefficiencies</h3><table><thead><tr><th>Player</th><th>Pos</th><th>Market</th><th>True</th><th>Edge</th><th>Ownership</th><th>Trend</th><th>Confidence</th><th>Freshness</th></tr></thead><tbody>{players.length === 0 ? <tr><td colSpan={9}>No production market records available. Connect adapters or enable labeled fixtures.</td></tr> : players.map((p) => { const ci = confidenceInterval(p.trueValue, p.confidence); return <tr key={p.id}><td>{p.name}</td><td>{p.position}</td><td>{p.perceivedValue}</td><td>{p.trueValue} <small>[{ci[0]}, {ci[1]}]</small></td><td>{reputationEdge(p)}</td><td>{p.ownershipLeverage}</td><td>{narrativeVelocity(p) >= 0 ? "↗" : "↘"}</td><td>{Math.round(p.confidence * 100)}%</td><td>{p.sources[0]?.freshness}</td></tr>; })}</tbody></table></div>;
}

function OrbitalUniverse({ players, reduceMotion }: { players: PlayerMarketRecord[]; reduceMotion: boolean }) {
  return <div className="orbital" aria-label="Orbital player ecosystem topology">{players.length === 0 ? <EmptyState /> : players.map((p, i) => { const angle = (i / players.length) * Math.PI * 2; const radius = 26 + p.trueValue * 0.34; return <motion.div key={p.id} className="orbital-node" style={{ left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius * 0.58}%` }} animate={reduceMotion ? {} : { scale: [1, 1.08, 1] }} transition={{ duration: 5 + i, repeat: Infinity }}><b>{p.name}</b><span>{p.position} · Rep {Math.round(p.trueValue)}</span></motion.div>; })}<div className="orbital-core">Player<br />Universe</div></div>;
}

function SelectedPlayer({ player }: { player?: PlayerMarketRecord }) {
  if (!player) return <ScoreCard title="Selected player" value="Unavailable" detail="No validated player record is loaded." />;
  return <div className="selected-player"><h3>{player.name}</h3>{[["Reputation score", player.trueValue], ["Market value", player.perceivedValue], ["Volatility", player.volatility], ["Fragility", player.fragility], ["Breakout odds", player.opportunity], ["Confidence", Math.round(player.confidence * 100)]].map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}<small>Source: {player.sources[0]?.source}</small></div>;
}

function NarrativeFlow({ players, reduceMotion }: { players: PlayerMarketRecord[]; reduceMotion: boolean }) {
  return <div className="narrative-flow"><h3>Narrative Flow Field</h3>{players.length === 0 ? <EmptyState /> : players.map((p, i) => <motion.div key={p.id} className="wave" style={{ inset: `${8 + i * 4}% ${8 + i * 5}%`, borderColor: p.narrativePressure >= 0 ? "rgba(154,215,170,.45)" : "rgba(215,140,118,.45)" }} animate={reduceMotion ? {} : { rotate: [0, 2 + i, 0], scale: [0.98, 1.03, 0.98] }} transition={{ duration: 6 + i, repeat: Infinity }}><span>{p.name} · half-life {Math.max(2, Math.round(80 - Math.abs(p.narrativePressure)))}d</span></motion.div>)}</div>;
}

function NarrativeCards({ players }: { players: PlayerMarketRecord[] }) {
  return <div className="cards-row">{players.slice(0, 4).map((p) => <ScoreCard key={p.id} title={p.name} value={`${narrativeVelocity(p)}`} detail={`Tone ${p.narrativePressure >= 0 ? "positive" : "negative"}; viral velocity confidence ${Math.round(p.confidence * 100)}%.`} />)}</div>;
}

function OutcomeMultiverse({ players, sim, reduceMotion }: { players: PlayerMarketRecord[]; sim: ReturnType<typeof runNexusSimulation>; reduceMotion: boolean }) {
  return <div className="multiverse"><svg viewBox="0 0 760 300" role="img" aria-label="Outcome multiverse branching futures">{players.map((p, i) => <motion.path key={p.id} d={`M30 150 C 220 ${40 + i * 28}, 410 ${260 - i * 23}, 730 ${70 + i * 24}`} fill="none" stroke={p.fragility > 55 ? "#d9866f" : "#77d7b0"} strokeWidth="1.5" opacity="0.6" animate={reduceMotion ? {} : { pathLength: [0.2, 1] }} transition={{ duration: 5 + i * 0.2, repeat: Infinity, repeatType: "reverse" }} />)}<circle cx="30" cy="150" r="10" fill="#d9f3ff" /></svg><div className="drivers"><h3>Key drivers</h3>{sim.keyDrivers.map((driver) => <p key={driver.id}><span>{driver.name}</span><b>{driver.contribution}</b></p>)}</div></div>;
}

function IntelFeed({ envelope }: { envelope: RAEEnvelope }) {
  return <div className="intel-feed"><h3>Intelligence Feed</h3><p>{envelope.sourceState.freshness === "fixture" ? "Fixture mode is active. This is not live fantasy intelligence." : envelope.sourceState.failure ?? "Adapter state nominal."}</p><ul>{envelope.sourceState.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>;
}

function DraftIntelligence({ players }: { players: PlayerMarketRecord[] }) {
  const best = [...players].sort((a, b) => reputationEdge(b) - reputationEdge(a))[0];
  return <div className="draft-card"><h3>Draft Intelligence Drawer</h3><p>Contextual war-room module; not a top-level tab.</p>{best ? <><b>Best value: {best.name}</b><span>Why: positive reputation edge, opportunity-adjusted leverage, confidence {Math.round(best.confidence * 100)}%.</span></> : <span>No recommendation without validated market data.</span>}</div>;
}

function ScoreCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="score-card"><small>{title}</small><strong>{value}</strong><p>{detail}</p></article>;
}

function EmptyState() { return <div className="empty-state"><b>Data unavailable</b><span>RAE will not fabricate topology nodes, rankings, or simulations.</span></div>; }
function avg(values: number[]): number { return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : Number.NaN; }
function slug(value: string): string { return value.toLowerCase().replaceAll(" ", "-"); }
