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
  // Players drafted by OTHER teams — removed from the pool so you can mock how
  // the board falls as opponents pick, without adding them to your roster.
  const [taken, setTaken] = useState<Set<string>>(new Set());

  const myRoster = useMemo(() => players.filter((p) => myPicks.has(p.id)), [players, myPicks]);
  const available = useMemo(
    () => players.filter((p) => !myPicks.has(p.id) && !taken.has(p.id)),
    [players, myPicks, taken]
  );
  const recommendations = useMemo(() => recommend({ available, myRoster }, 8), [available, myRoster]);
  const tiers = useMemo(() => tiersByPosition(available), [available]);
  const collapseSignals = useMemo(() => tierCollapseSignals(tiers), [tiers]);
  const grades = useMemo(() => derivePositionGrades(myRoster), [myRoster]);

  // Draft to MY team (also clears any opponent mark); to an OPPONENT (clears any
  // mine mark); release returns a player to the pool.
  const draftMine = (id: string) => {
    setTaken((t) => { const n = new Set(t); n.delete(id); return n; });
    setMyPicks((p) => { const n = new Set(p); n.add(id); return n; });
  };
  const draftOpponent = (id: string) => {
    setMyPicks((p) => { const n = new Set(p); n.delete(id); return n; });
    setTaken((t) => { const n = new Set(t); n.add(id); return n; });
  };
  const release = (id: string) => {
    setMyPicks((p) => { const n = new Set(p); n.delete(id); return n; });
    setTaken((t) => { const n = new Set(t); n.delete(id); return n; });
  };
  const reset = () => { setMyPicks(new Set()); setTaken(new Set()); };

  return (
    <PanelCard
      id="draft-intelligence"
      titleId="dr-title"
      title="Draft Intelligence"
      eyebrow="Read the room. Anticipate the run."
      icon={<ClipboardList />}
      controls={
        <span className="draft-controls">
          <span className="muted-text">{myRoster.length} mine · {taken.size} taken · {available.length} left</span>
          {(myPicks.size > 0 || taken.size > 0) && (
            <button type="button" className="draft-reset-btn" onClick={reset}>Reset</button>
          )}
        </span>
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
          takenCount={taken.size}
          onDraftMine={draftMine}
          onDraftOpponent={draftOpponent}
          onRelease={release}
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
  takenCount,
  onDraftMine,
  onDraftOpponent,
  onRelease,
  recommendations
}: {
  available: PlayerMarketRecord[];
  myRoster: PlayerMarketRecord[];
  takenCount: number;
  onDraftMine: (id: string) => void;
  onDraftOpponent: (id: string) => void;
  onRelease: (id: string) => void;
  recommendations: Recommendation[];
}) {
  const topPick = recommendations[0];
  return (
    <div className="universe-layout">
      <div className="table-wrap" tabIndex={0}>
        <div className="section-label">AVAILABLE — draft to your team or mark taken by an opponent</div>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>True</th>
              <th>Edge</th>
              <th>Draft</th>
            </tr>
          </thead>
          <tbody>
            {available.length === 0 && (
              <tr>
                <td colSpan={6}>No available players (or empty envelope).</td>
              </tr>
            )}
            {available.slice(0, 16).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.position}</td>
                <td>{p.team ?? "—"}</td>
                <td>{Math.round(p.trueValue)}</td>
                <td className={reputationEdge(p) >= 0 ? "pos-text" : "neg-text"}>
                  {reputationEdge(p) >= 0 ? "+" : ""}
                  {reputationEdge(p)}
                </td>
                <td className="draft-actions">
                  <button
                    type="button"
                    className="draft-btn draft-btn-mine"
                    onClick={() => onDraftMine(p.id)}
                    aria-label={`Draft ${p.name} to my team`}
                  >
                    + Mine
                  </button>
                  <button
                    type="button"
                    className="draft-btn draft-btn-opp"
                    onClick={() => onDraftOpponent(p.id)}
                    aria-label={`Mark ${p.name} taken by an opponent`}
                  >
                    Taken
                  </button>
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
          <div className="section-label">YOUR ROSTER ({myRoster.length}) · {takenCount} taken</div>
          <ul className="rising-list">
            {myRoster.length === 0 && <li className="muted-text">No picks yet — use “+ Mine” to draft, “Taken” to mock opponents.</li>}
            {myRoster.map((p) => (
              <li key={p.id} className="rising-item draft-roster-row" onClick={() => onRelease(p.id)} title="Click to release">
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
        Ranked by composite draft score. VALUE = underpriced · NEED = positional gap · RUN = last in a tier (act now) · STASH = depth pick.
      </p>
    </div>
  );
}
