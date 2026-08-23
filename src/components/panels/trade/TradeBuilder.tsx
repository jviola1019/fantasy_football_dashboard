"use client";

import { useMemo, useState } from "react";
import type { PlayerValue } from "@/lib/trade/values";
import type { LeagueFormat } from "@/lib/trade/format";
import { evaluateTrade } from "@/lib/trade/evaluate";

type Side = "A" | "B";

export function TradeBuilder({
  players,
  format
}: {
  players: PlayerValue[];
  format: LeagueFormat;
}) {
  const [query, setQuery] = useState("");
  const [sideA, setSideA] = useState<PlayerValue[]>([]);
  const [sideB, setSideB] = useState<PlayerValue[]>([]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [players, query]);

  const verdict = useMemo(() => evaluateTrade(sideA, sideB), [sideA, sideB]);

  const add = (side: Side, p: PlayerValue) => {
    (side === "A" ? setSideA : setSideB)((prev) =>
      prev.some((x) => x.sleeperId === p.sleeperId) ? prev : [...prev, p]
    );
    setQuery("");
  };
  const remove = (side: Side, id: string | null) => {
    (side === "A" ? setSideA : setSideB)((prev) => prev.filter((x) => x.sleeperId !== id));
  };

  return (
    <div className="trade-builder">
      <div className="section-label">
        TRADE BUILDER — {format.numTeams}-team · {format.numQbs}QB · {format.ppr} PPR
      </div>
      <input
        className="galaxy-search"
        type="search"
        placeholder="Search players to add..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search players"
      />
      {results.length > 0 && (
        <ul className="trade-search-results">
          {results.map((p) => (
            <li key={p.sleeperId}>
              <span>{p.name} · {p.position} · {p.value}</span>
              <span>
                <button type="button" onClick={() => add("A", p)} aria-label={`Add ${p.name} to You give`}>
                  + Give
                </button>
                <button type="button" onClick={() => add("B", p)} aria-label={`Add ${p.name} to You get`}>
                  + Get
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="trade-sides">
        <TradeSideColumn label="You give" side="A" players={sideA} onRemove={remove} />
        <TradeSideColumn label="You get" side="B" players={sideB} onRemove={remove} />
      </div>
      <div className={`trade-verdict trade-verdict-${verdict.verdict}`} role="status">
        {verdict.unpriced ? (
          // Both sides must carry at least one priced player before any verdict
          // is honest. Saying nothing is correct here; "Fair trade" was not.
          <>Add players on both sides with available trade values to grade this trade.</>
        ) : (
          <>
            <b>{verdict.totalA}</b> vs <b>{verdict.totalB}</b> ·{" "}
            {verdict.verdict === "balanced"
              ? "Fair trade"
              : verdict.winner === "B"
                ? `${(verdict.pctDelta * 100).toFixed(0)}% in your favor`
                : `${(verdict.pctDelta * 100).toFixed(0)}% against you`}
          </>
        )}
      </div>
    </div>
  );
}

function TradeSideColumn({
  label,
  side,
  players,
  onRemove
}: {
  label: string;
  side: Side;
  players: PlayerValue[];
  onRemove: (side: Side, id: string | null) => void;
}) {
  const total = players.reduce((s, p) => s + p.value, 0);
  return (
    <div className="trade-side">
      <div className="trade-side-head">{label} · {total}</div>
      <ul>
        {players.length === 0 && <li className="muted-text">No players added.</li>}
        {players.map((p) => (
          <li key={p.sleeperId}>
            <span>{p.name} · {p.position}</span>
            <span>{p.value}</span>
            <button
              type="button"
              onClick={() => onRemove(side, p.sleeperId)}
              aria-label={`Remove ${p.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
