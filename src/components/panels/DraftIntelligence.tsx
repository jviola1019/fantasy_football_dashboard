"use client";

import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { recommend, type Recommendation } from "@/lib/draft/recommend";
import { tierCollapseSignals, tiersByPosition } from "@/lib/draft/tiers";
import { RadarChart } from "@/components/charts/RadarChart";
import { derivePositionGrades } from "@/lib/derivedMetrics";
import { reputationEdge } from "@/lib/models";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs } from "../ui/PanelTabs";

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
    <PanelCard
      id="draft-intelligence"
      titleId="dr-title"
      title="Draft Intelligence"
      eyebrow="Read the room. Anticipate the run."
      icon={<ClipboardList />}
      controls={
        <span className="muted-text">{myRoster.length} on roster · {available.length} available</span>
      }
    >
      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Draft Intelligence tabs"
      />

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
        <DraftBoardView recommendations={recommendations} />
      )}
    </PanelCard>
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
      <div className="table-wrap" tabIndex={0}>
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
    <div className="table-wrap" tabIndex={0}>
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
      <div className="table-wrap" tabIndex={0}>
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
        <div className="section-label">POSITION STRENGTH RADAR</div>
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

function DraftBoardView({ recommendations }: { recommendations: Recommendation[] }) {
  const maxScore = Math.max(...recommendations.map((r) => r.score), 1);
  return (
    <div className="multiverse-wrap">
      <div className="section-label">DRAFT RECOMMENDATION BOARD</div>
      {recommendations.length === 0 ? (
        <p className="draft-board-empty">
          No recommendations yet — draft players on the Live Board to populate this view.
        </p>
      ) : (
        <ol className="draft-board-list" aria-label="Draft recommendation board ranked by score">
          {recommendations.map((rec, idx) => (
            <li key={rec.player.id} className="draft-board-row">
              <span className="draft-board-rank">{idx + 1}</span>
              <span className="draft-board-name" title={rec.player.name}>
                {rec.player.name}
              </span>
              <span className="pos-badge" data-pos={rec.player.position.toLowerCase()}>
                {rec.player.position}
              </span>
              <span className="draft-board-category">{rec.category}</span>
              <div className="draft-board-bar-wrap" aria-hidden="true">
                <div
                  className="draft-board-bar"
                  style={{ ["--bar-w" as string]: `${Math.round((rec.score / maxScore) * 100)}%` }}
                />
              </div>
              <span className="draft-board-score">{rec.score}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="small-note draft-board-note">
        Ranked by composite draft score. VALUE = underpriced opportunity · NEED = positional gap · UPSIDE = high-ceiling pick.
      </p>
    </div>
  );
}
