import type { GradedTrade } from "@/lib/trade/transactions";

export function RecentLeagueTrades({ trades }: { trades: GradedTrade[] }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent league trades table">
      <div className="section-label">RECENT LEAGUE TRADES</div>
      {trades.length === 0 ? (
        <p className="muted-note">
          No league trades to grade. Connect a Sleeper or ESPN league in Settings to see real
          transactions graded here.
        </p>
      ) : (
        <table>
          <thead>
            <tr><th>Side A</th><th>Side B</th><th>Value</th><th>Verdict</th></tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{t.sideA.map((p) => p.name).join(", ") || "—"}</td>
                <td>{t.sideB.map((p) => p.name).join(", ") || "—"}</td>
                <td>{t.verdict.unpriced ? "—" : `${t.verdict.totalA} / ${t.verdict.totalB}`}</td>
                {/* Two different absences of a grade, said differently.
                    "not priced" previously read "balanced", because 0 vs 0
                    scores as a perfect tie — the strongest claim available,
                    from no data. "multi-team" is new (P1-4): a three-way deal
                    was being graded as two-sided, with the third team's players
                    counted under the second team's name. */}
                <td
                  className={
                    t.verdict.unpriced ? "muted-note" : t.verdict.verdict === "balanced" ? "pos-text" : "neu-text"
                  }
                  title={
                    t.verdict.verdict === "multi-team"
                      ? `${t.verdict.teamCount}-team trade — a two-sided fairness score would not describe it`
                      : t.verdict.unpriced
                        ? "No trade values available for these players"
                        : undefined
                  }
                >
                  {t.verdict.verdict === "multi-team"
                    ? `${t.verdict.teamCount}-team — not graded`
                    : t.verdict.unpriced
                      ? "not priced"
                      : t.verdict.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
