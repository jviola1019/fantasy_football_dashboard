"use client";

import { ListChecks } from "lucide-react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { derivePositionGrades } from "@/lib/derivedMetrics";
import { PanelCard } from "../ui/PanelCard";

type Props = {
  players: PlayerMarketRecord[];
};

interface AuditRow {
  setting: string;
  expected: string;
  current: string;
  status: "ok" | "warn" | "miss";
  note?: string;
}

// Strategy assumptions. In a later sprint these will be read from a per-user
// /settings/strategy form; for now the defaults reflect typical 12-team PPR.
const DEFAULT_STRATEGY = {
  scoringFormat: "PPR",
  teams: 12,
  rosterSize: 16,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1 },
  tradeDeadlineWeek: 11,
  playoffWeeks: [15, 16, 17]
};

export function PreDraftAudit({ players }: Props) {
  const grades = derivePositionGrades(players);

  const rows: AuditRow[] = [
    {
      setting: "Scoring format",
      expected: DEFAULT_STRATEGY.scoringFormat,
      current: "Read from league settings (Sleeper getLeague().scoring_settings / ESPN mSettings)",
      status: "warn",
      note: "Pending live league fetch wiring."
    },
    {
      setting: "Roster size",
      expected: String(DEFAULT_STRATEGY.rosterSize),
      current: String(DEFAULT_STRATEGY.rosterSize),
      status: "ok"
    },
    {
      setting: "Starting QB",
      expected: String(DEFAULT_STRATEGY.starters.QB),
      current: String(DEFAULT_STRATEGY.starters.QB),
      status: "ok"
    },
    {
      setting: "Starting RB / WR",
      expected: `${DEFAULT_STRATEGY.starters.RB} / ${DEFAULT_STRATEGY.starters.WR}`,
      current: `${DEFAULT_STRATEGY.starters.RB} / ${DEFAULT_STRATEGY.starters.WR}`,
      status: "ok"
    },
    {
      setting: "Trade deadline",
      expected: `Week ${DEFAULT_STRATEGY.tradeDeadlineWeek}`,
      current: "Read from league settings",
      status: "warn",
      note: "Live wiring planned."
    },
    {
      setting: "Playoff weeks",
      expected: DEFAULT_STRATEGY.playoffWeeks.join(", "),
      current: "Read from league settings",
      status: "warn",
      note: "Live wiring planned."
    }
  ];

  const positionRows = grades.positions;

  return (
    <PanelCard
      id="pre-draft-audit"
      titleId="pda-title"
      title="Pre-Draft Audit"
      eyebrow="Verify your league config before the clock starts."
      icon={<ListChecks />}
    >
      <div className="universe-layout">
        <div className="table-wrap" tabIndex={0}>
          <div className="section-label">LEAGUE SETTINGS</div>
          <table>
            <thead>
              <tr>
                <th>Setting</th>
                <th>Expected</th>
                <th>Current</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.setting}>
                  <td>{row.setting}</td>
                  <td>{row.expected}</td>
                  <td>{row.current}</td>
                  <td>
                    <span
                      className={
                        row.status === "ok" ? "pos-text" : row.status === "warn" ? "neu-text" : "neg-text"
                      }
                    >
                      {row.status.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <small>{row.note ?? ""}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="universe-sidebar">
          <div className="player-profile-card">
            <div className="momentum-header">POSITION STRENGTH</div>
            <ul className="rising-list">
              {positionRows.map((row) => (
                <li key={row.pos} className="rising-item">
                  <span>{row.pos}</span>
                  <span className={`grade-val grade-${row.grade[0]?.toLowerCase()}`}>{row.grade}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="small-note">
            Position grades are computed from `derivedMetrics.positionGrades` against the current
            envelope. Live league settings will replace the placeholder rows once the per-league
            settings cache lands.
          </p>
        </div>
      </div>
    </PanelCard>
  );
}
