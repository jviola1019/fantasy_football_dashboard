"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import type { LeagueFormat } from "@/lib/trade/format";
import { derivePositionGrades, type PositionGrades } from "@/lib/derivedMetrics";
import { lineupMeshScore, targetsFromFormat } from "@/lib/draft/rosterTargets";
import { evaluateKeepers } from "@/lib/draft/keepers";
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
  format,
  board
}: {
  players: PlayerMarketRecord[];
  fragilityMissing: boolean;
  format?: LeagueFormat | null;
  /** Draftable pool, best-first — used to price what a keeper costs. */
  board?: PlayerMarketRecord[];
}) {
  const grades = derivePositionGrades(players, format ?? null);
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
      <KeeperBoard players={players} board={board ?? []} format={format ?? null} />
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

/**
 * Keeper decisions, priced as surplus over the pick they cost.
 *
 * Renders an explicit unavailable state — including WHY and what to do — rather
 * than a recommendation, whenever the league rule is unconfirmed. A keeper
 * choice is irreversible for the season, so a guess is worse than silence.
 */
function KeeperBoard({
  players,
  board,
  format
}: {
  players: PlayerMarketRecord[];
  board: PlayerMarketRecord[];
  format: LeagueFormat | null;
}) {
  if (!format || format.leagueType !== "keeper" || format.keeperCount <= 0) return null;

  const analysis = evaluateKeepers({
    roster: players,
    board,
    format,
    draftSlot: format.draftSlot ?? null
  });

  return (
    <div className="mini-panel" style={{ marginTop: 12 }}>
      <div className="mini-panel-title">
        Keeper decision — {format.keeperCount} allowed
      </div>

      {analysis.status === "unavailable" ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {analysis.detail}
          {analysis.reason === "cost-rule-unconfirmed" && (
            <>
              {" "}
              <a className="demo-banner-cta" href="/settings/leagues">
                Set it in league settings →
              </a>
            </>
          )}
        </p>
      ) : (
        <>
          {analysis.keepNobody && (
            <p className="muted" style={{ marginTop: 8 }}>
              <strong style={{ color: "var(--amber)" }}>Keep nobody.</strong> No player on this roster is
              worth more than the pick you would give up. Filling the slot anyway hands value back.
            </p>
          )}
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Cost</th>
                <th>Pick worth</th>
                <th>Surplus</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {analysis.candidates.slice(0, 8).map((c) => (
                <tr key={c.player.id}>
                  <td>{c.player.name}</td>
                  <td>{c.costRound ? `R${c.costRound}` : "free"}</td>
                  <td>{c.pickValue.toFixed(0)}</td>
                  <td className={c.surplus > 0 ? "pos-text" : "neg-text"}>
                    {c.surplus > 0 ? "+" : ""}
                    {c.surplus.toFixed(0)}
                  </td>
                  <td>{c.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="muted" style={{ marginTop: 8, paddingLeft: 16, listStyle: "disc" }}>
            {analysis.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
