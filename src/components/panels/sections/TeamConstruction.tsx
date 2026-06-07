"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import { derivePositionGrades, type PositionGrades } from "@/lib/derivedMetrics";
import { PanelCard } from "../../ui/PanelCard";

/**
 * Team Construction (/draft) — the position-grade scorecard, re-homed verbatim
 * from the former CommandCenter so roster-construction context sits with the draft
 * tools. The DEF grade is fragility-driven; when that field is missing it shows
 * "—" rather than a fabricated letter grade.
 */
export function TeamConstruction({
  players,
  fragilityMissing
}: {
  players: PlayerMarketRecord[];
  fragilityMissing: boolean;
}) {
  const grades = derivePositionGrades(players);
  return (
    <PanelCard
      id="team-construction"
      titleId="tc2-title"
      title="Team Construction"
      eyebrow="Position-by-position roster grade."
    >
      <div className="bottom-row">
        <TeamConstructionScore grades={grades} fragilityMissing={fragilityMissing} />
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
