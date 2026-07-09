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
                <td>{t.verdict.totalA} / {t.verdict.totalB}</td>
                <td className={t.verdict.verdict === "balanced" ? "pos-text" : "neu-text"}>
                  {t.verdict.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
