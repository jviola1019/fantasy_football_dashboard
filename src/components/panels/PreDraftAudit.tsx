"use client";

import { ListChecks } from "lucide-react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import type { LeagueFormat } from "@/lib/trade/format";
import { derivePositionGrades } from "@/lib/derivedMetrics";
import { PanelCard } from "../ui/PanelCard";

type Props = {
  players: PlayerMarketRecord[];
  envelope: RAEEnvelope;
};

interface AuditRow {
  setting: string;
  expected: string;
  current: string;
  status: "ok" | "warn" | "miss";
  note?: string;
}

// Detect which platform a LeagueFormat was parsed from so the "field not
// present" note can name the actual upstream payload. We piggyback on the
// envelope's sourceState string since LeagueFormat itself doesn't carry
// platform metadata.
function platformLabel(envelope: RAEEnvelope): string {
  const src = envelope.sourceState.source.toLowerCase();
  if (src.includes("espn")) return "ESPN mSettings";
  if (src.includes("sleeper")) return "Sleeper league settings";
  return "league settings";
}

function rowsForFormat(format: LeagueFormat, platform: string): AuditRow[] {
  const rows: AuditRow[] = [
    {
      setting: "Scoring format",
      expected: format.scoringFormat,
      current: format.scoringFormat,
      status: "ok"
    },
    {
      setting: "Teams",
      expected: String(format.numTeams),
      current: String(format.numTeams),
      status: "ok"
    },
    {
      setting: "Roster size",
      expected: String(format.rosterSize),
      current: String(format.rosterSize),
      status: "ok"
    },
    {
      setting: "Starting QB",
      expected: String(format.starters.QB + (format.starters.SUPERFLEX > 0 ? `+${format.starters.SUPERFLEX} OP` : "")),
      current: String(format.starters.QB),
      status: "ok"
    },
    {
      setting: "Starting RB / WR",
      expected: `${format.starters.RB} / ${format.starters.WR}`,
      current: `${format.starters.RB} / ${format.starters.WR}`,
      status: "ok"
    },
    {
      setting: "Starting TE / FLEX",
      expected: `${format.starters.TE} / ${format.starters.FLEX}`,
      current: `${format.starters.TE} / ${format.starters.FLEX}`,
      status: "ok"
    },
    {
      setting: "Trade deadline",
      expected: format.tradeDeadlineWeek != null ? `Week ${format.tradeDeadlineWeek}` : "—",
      current: format.tradeDeadlineWeek != null ? `Week ${format.tradeDeadlineWeek}` : "—",
      status: format.tradeDeadlineWeek != null ? "ok" : "miss",
      note: format.tradeDeadlineWeek != null ? undefined : `Field not present in ${platform}.`
    },
    {
      setting: "Playoff week start",
      expected: format.playoffWeekStart != null ? `Week ${format.playoffWeekStart}` : "—",
      current: format.playoffWeekStart != null ? `Week ${format.playoffWeekStart}` : "—",
      status: format.playoffWeekStart != null ? "ok" : "miss",
      note: format.playoffWeekStart != null ? undefined : `Field not present in ${platform}.`
    },
    {
      setting: "Playoff teams",
      expected: format.playoffTeams != null ? String(format.playoffTeams) : "—",
      current: format.playoffTeams != null ? String(format.playoffTeams) : "—",
      status: format.playoffTeams != null ? "ok" : "miss",
      note: format.playoffTeams != null ? undefined : `Field not present in ${platform}.`
    }
  ];
  if (format.starters.SUPERFLEX > 0) {
    rows.splice(3, 1, {
      setting: "Starting QB (Superflex)",
      expected: `${format.starters.QB} + ${format.starters.SUPERFLEX} OP`,
      current: `${format.starters.QB} + ${format.starters.SUPERFLEX} OP`,
      status: "ok",
      note: "Superflex / 2QB lineup detected."
    });
  }
  return rows;
}

export function PreDraftAudit({ players, envelope }: Props) {
  const grades = derivePositionGrades(players);
  const format = envelope.leagueFormat ?? null;
  const platform = platformLabel(envelope);
  const rows = format ? rowsForFormat(format, platform) : [];
  const positionRows = grades.positions;

  return (
    <PanelCard
      id="pre-draft-audit"
      titleId="pda-title"
      title="Pre-Draft Audit"
      eyebrow="Read your league config before the clock starts."
      icon={<ListChecks />}
    >
      <div className="universe-layout">
        <div className="table-wrap" tabIndex={0}>
          <div className="section-label">DETECTED LEAGUE SETTINGS</div>
          {!format ? (
            <p className="small-note" role="status">
              Connect a league at <code>/settings/leagues</code> to read your scoring, roster slots,
              trade deadline, and playoff weeks. Without a connected league the dashboard renders
              fixture data and this panel has nothing to read.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                  <th>Source</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.setting}>
                    <td>{row.setting}</td>
                    <td>{row.current}</td>
                    <td>
                      <span className={row.status === "miss" ? "neg-text" : "pos-text"}>
                        {row.status === "miss" ? "not provided" : "detected"}
                      </span>
                    </td>
                    <td>
                      <small>{row.note ?? ""}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="universe-sidebar">
          <div className="player-profile-card">
            <div className="momentum-header">POOL STRENGTH BY POSITION</div>
            <ul className="rising-list">
              {positionRows.map((row) => (
                <li key={row.pos} className="rising-item">
                  <span>{row.pos}</span>
                  <span className={`grade-val grade-${row.grade[0]?.toLowerCase()}`}>{row.grade}</span>
                </li>
              ))}
            </ul>
          </div>
          {format ? (
            <p className="small-note">
              Settings extracted live from {platform}. Position grades derive from{" "}
              <code>derivePositionGrades</code> against the current envelope.
            </p>
          ) : (
            <p className="small-note">
              Position grades against the demo fixture — connect your league for real values.
            </p>
          )}
        </div>
      </div>
    </PanelCard>
  );
}
