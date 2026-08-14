"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import type { LeagueFormat } from "@/lib/trade/format";
import { derivePositionGrades, type PositionGrades } from "@/lib/derivedMetrics";
import { lineupMeshScore, targetsFromFormat } from "@/lib/draft/rosterTargets";
import { PanelCard } from "../../ui/PanelCard";

/**
 * Team Construction (/draft) — the position-grade scorecard, plus lineup fit.
 *
 * The DEF grade is fragility-driven; when that field is missing it shows "—"
 * rather than a fabricated letter grade.
 *
 * Audit 2026-08-06 F-010/F-012: the grade card alone left most of this panel
 * empty and duplicated the grades already shown in Pre-Draft Audit. Lineup Fit
 * answers a genuinely different question — not "how good are these players" but
 * "does this roster actually fill THIS league's starting lineup" — and it is
 * computed from the connected league's real starters, so a superflex or 2-TE
 * league is graded against its own requirements.
 */
export function TeamConstruction({
  players,
  fragilityMissing,
  format
}: {
  players: PlayerMarketRecord[];
  fragilityMissing: boolean;
  format?: LeagueFormat | null;
}) {
  const grades = derivePositionGrades(players);
  return (
    <PanelCard
      id="team-construction"
      titleId="tc2-title"
      title="Team Construction"
      eyebrow="Position-by-position roster grade, and how it fits your league's lineup."
    >
      <div className="bottom-row">
        <TeamConstructionScore grades={grades} fragilityMissing={fragilityMissing} />
        <LineupFit players={players} format={format ?? null} />
      </div>
    </PanelCard>
  );
}

function TeamConstructionScore({ grades, fragilityMissing }: { grades: PositionGrades; fragilityMissing: boolean }) {
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Team Construction Score</div>
      <div className="overall-grade">{grades.overall}</div>
      <div className="position-grades">
        {grades.positions.map(({ pos, grade }) => {
          const show = pos === "DEF" && fragilityMissing ? "—" : grade;
          return (
            <div key={pos} className="pos-grade-row">
              <span className="pos-label">{pos}</span>
              <span className={`grade-val grade-${show[0]?.toLowerCase()}`}>{show}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Lineup fit against the league's ACTUAL starting slots. Renders an explicit
 * unavailable state when no league is connected rather than grading against an
 * assumed 12-team 1QB PPR default.
 */
function LineupFit({ players, format }: { players: PlayerMarketRecord[]; format: LeagueFormat | null }) {
  if (!format) {
    return (
      <div className="mini-panel" style={{ flex: 1, minWidth: 0 }}>
        <div className="mini-panel-title">Lineup Fit</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Unavailable — connect a league in Settings. Lineup fit is graded against your league&apos;s
          real starting slots (including FLEX and superflex), so it is not estimated from a default.
        </p>
      </div>
    );
  }

  const mesh = lineupMeshScore(players, format);
  const targets = targetsFromFormat(format);
  const coveragePct = Math.round(mesh.starterCoverage * 100);

  return (
    <div className="mini-panel" style={{ flex: 1, minWidth: 0 }}>
      <div className="mini-panel-title">Lineup Fit</div>
      <div className="overall-grade" aria-label={`Lineup fit grade ${mesh.grade}, score ${mesh.score} of 100`}>
        {mesh.grade}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        {mesh.score}/100 · {mesh.startersFilled} of {mesh.startersRequired} starting slots filled ({coveragePct}%)
      </p>

      <div className="position-grades" style={{ marginTop: 10 }}>
        {mesh.gaps.length === 0 && mesh.surplus.length === 0 && (
          <div className="pos-grade-row">
            <span className="pos-label">Balanced</span>
            <span className="grade-val grade-a">on target</span>
          </div>
        )}
        {mesh.gaps.slice(0, 4).map((g) => (
          <div key={`gap-${g.position}`} className="pos-grade-row">
            <span className="pos-label">{g.position}</span>
            <span className="grade-val grade-c">
              need {g.short} more (have {g.have} / {targets[g.position]})
            </span>
          </div>
        ))}
        {mesh.surplus.slice(0, 3).map((s) => (
          <div key={`sur-${s.position}`} className="pos-grade-row">
            <span className="pos-label">{s.position}</span>
            <span className="grade-val grade-d">
              {s.over} over target (have {s.have} / {s.target})
            </span>
          </div>
        ))}
      </div>

      {mesh.notes.length > 0 && (
        <ul className="muted" style={{ marginTop: 10, paddingLeft: 16, listStyle: "disc" }}>
          {mesh.notes.slice(0, 3).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <p className="muted" style={{ marginTop: 10 }}>
        Targets derived from your league&apos;s starters ({format.starters.QB}QB/{format.starters.RB}RB/
        {format.starters.WR}WR/{format.starters.TE}TE
        {format.starters.FLEX > 0 ? `/${format.starters.FLEX}FLEX` : ""}
        {format.starters.SUPERFLEX > 0 ? `/${format.starters.SUPERFLEX}SFLEX` : ""}) and a{" "}
        {format.rosterSize}-man roster — not a fixed assumption.
      </p>
    </div>
  );
}
