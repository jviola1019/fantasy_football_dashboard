"use client";

import { useMemo, useState } from "react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { recommend, type Recommendation } from "@/lib/draft/recommend";
import { tierCollapseSignals, tiersByPosition } from "@/lib/draft/tiers";
import { RadarChart } from "@/components/charts/RadarChart";
import { derivePositionGrades } from "@/lib/derivedMetrics";
import { Canvas3D } from "../three/Canvas3D";
import { DraftMultiverse } from "../three/scenes/DraftMultiverse";
import { reputationEdge } from "@/lib/models";

type Props = {
  players: PlayerMarketRecord[];
};

const TABS = ["Live Board", "Recommendations", "Tier Collapse", "Multiverse"] as const;

export function DraftIntelligence({ players }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Live Board");
  const [myPicks, setMyPicks] = useState<Set<string>>(new Set());

  const myRoster = useMemo(() => players.filter((p) => myPicks.has(p.id)), [players, myPicks]);
  const available = useMemo(() => players.filter((p) => !myPicks.has(p.id)), [players, myPicks]);
  const recommendations = useMemo(() => recommend({ available, myRoster }, 8), [available, myRoster]);
  const tiers = useMemo(() => tiersByPosition(available), [available]);
  const collapseSignals = useMemo(() => tierCollapseSignals(tiers), [tiers]);
  const grades = useMemo(() => derivePositionGrades(myRoster), [myRoster]);

  const togglePick = (id: string) =>
    setMyPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="system-panel panel-draft" id="draft-intelligence" aria-labelledby="dr-title">
      <div className="panel-header-row">
        <div className="panel-title">
          <div className="panel-icon">◬</div>
          <div>
            <h2 id="dr-title">Draft Intelligence</h2>
            <p className="panel-eyebrow">Read the room. Anticipate the run.</p>
          </div>
        </div>
        <div className="panel-header-controls">
          <span className="muted-text">{myRoster.length} on roster · {available.length} available</span>
        </div>
      </div>

      <div className="tab-row" role="tablist" aria-label="Draft Intelligence tabs">
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

      {activeTab === "Live Board" && (
        <LiveBoard
          available={available}
          myRoster={myRoster}
          onToggle={togglePick}
          recommendations={recommendations}
        />
      )}
      {activeTab === "Recommendations" && (
        <RecommendationQueue recommendations={recommendations} />
      )}
      {activeTab === "Tier Collapse" && (
        <TierCollapseView signals={collapseSignals} grades={grades} />
      )}
      {activeTab === "Multiverse" && (
        <div className="multiverse-wrap">
          <div className="section-label">DRAFT MULTIVERSE</div>
          <Canvas3D
            ariaLabel="3-D draft branching paths weighted by branch probability"
            height={260}
          >
            <DraftMultiverse />
          </Canvas3D>
          <p className="muted-note" style={{ marginTop: 6 }}>
            Tube color and thickness encode branch probability and projected roster delta. Connect a live Sleeper or ESPN draft to drive paths from actual remaining picks.
          </p>
        </div>
      )}
    </section>
  );
}

function LiveBoard({
  available,
  myRoster,
  onToggle,
  recommendations
}: {
  available: PlayerMarketRecord[];
  myRoster: PlayerMarketRecord[];
  onToggle: (id: string) => void;
  recommendations: Recommendation[];
}) {
  const topPick = recommendations[0];
  return (
    <div className="universe-layout">
      <div className="table-wrap">
        <div className="section-label">AVAILABLE — click to add to roster</div>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>True</th>
              <th>Edge</th>
            </tr>
          </thead>
          <tbody>
            {available.length === 0 && (
              <tr>
                <td colSpan={5}>No available players (or empty envelope).</td>
              </tr>
            )}
            {available.slice(0, 16).map((p) => (
              <tr key={p.id} onClick={() => onToggle(p.id)} style={{ cursor: "pointer" }}>
                <td>{p.name}</td>
                <td>{p.position}</td>
                <td>{p.team ?? "—"}</td>
                <td>{Math.round(p.trueValue)}</td>
                <td className={reputationEdge(p) >= 0 ? "pos-text" : "neg-text"}>
                  {reputationEdge(p) >= 0 ? "+" : ""}
                  {reputationEdge(p)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="universe-sidebar">
        <div className="player-profile-card">
          <div className="momentum-header">ON THE CLOCK — Top Suggestion</div>
          {topPick ? (
            <>
              <div className="profile-header">
                <div>
                  <div className="profile-name">{topPick.player.name}</div>
                  <div className="profile-pos">{topPick.player.position} · {topPick.player.team ?? "—"}</div>
                </div>
                <div className="profile-rep">{topPick.score}</div>
              </div>
              <div className="profile-metrics">
                <div className="profile-row">
                  <span>Category</span>
                  <b>{topPick.category}</b>
                </div>
                {topPick.reasons.map((reason) => (
                  <div key={reason} className="profile-row">
                    <span>·</span>
                    <b>{reason}</b>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted-note">No recommendations yet.</p>
          )}
        </div>
        <div className="universe-stats">
          <div className="section-label">YOUR ROSTER ({myRoster.length})</div>
          <ul className="rising-list">
            {myRoster.length === 0 && <li className="muted-text">No picks yet — click rows on the left to draft.</li>}
            {myRoster.map((p) => (
              <li key={p.id} className="rising-item" onClick={() => onToggle(p.id)} style={{ cursor: "pointer" }}>
                <span>{p.name}</span>
                <span className="muted-text">{p.position}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function RecommendationQueue({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <div className="table-wrap">
      <div className="section-label">RECOMMENDATION QUEUE</div>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Category</th>
            <th>Score</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {recommendations.length === 0 && (
            <tr>
              <td colSpan={5}>No recommendations.</td>
            </tr>
          )}
          {recommendations.map((rec) => (
            <tr key={rec.player.id}>
              <td>{rec.player.name}</td>
              <td>{rec.player.position}</td>
              <td>
                <span className={`fixture-badge`}>{rec.category}</span>
              </td>
              <td>{rec.score}</td>
              <td>
                <small>{rec.reasons.join(" · ") || "general value"}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TierCollapseView({
  signals,
  grades
}: {
  signals: ReturnType<typeof tierCollapseSignals>;
  grades: ReturnType<typeof derivePositionGrades>;
}) {
  return (
    <div className="nexus-full">
      <div className="table-wrap">
        <div className="section-label">TIER COLLAPSE FORECAST</div>
        <table>
          <thead>
            <tr>
              <th>Pos</th>
              <th>Tier</th>
              <th>Remaining</th>
              <th>Cliff</th>
              <th>Intensity</th>
            </tr>
          </thead>
          <tbody>
            {signals.length === 0 && (
              <tr>
                <td colSpan={5}>No tier signals.</td>
              </tr>
            )}
            {signals.map((s) => (
              <tr key={`${s.position}-${s.tierRank}`}>
                <td>{s.position}</td>
                <td>Tier {s.tierRank}</td>
                <td>{s.remaining}</td>
                <td>{s.cliff.toFixed(1)}</td>
                <td>
                  <span className={s.intensity > 0.5 ? "neg-text" : s.intensity > 0.25 ? "neu-text" : "pos-text"}>
                    {(s.intensity * 100).toFixed(0)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="radar-wrap">
        <div className="section-label">ROSTER FRAGILITY X-RAY</div>
        <RadarChart
          axes={grades.positions.map((p) => ({ label: p.pos, value: scoreFromGrade(p.grade) }))}
          max={100}
          size={180}
        />
      </div>
    </div>
  );
}

function scoreFromGrade(grade: string): number {
  switch (grade[0]) {
    case "A":
      return 95;
    case "B":
      return 80;
    case "C":
      return 60;
    case "D":
      return 40;
    default:
      return 50;
  }
}
