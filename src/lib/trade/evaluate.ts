import type { PlayerValue } from "./values";

export type Verdict = "balanced" | "slight-edge" | "lopsided";

export interface TradeVerdict {
  totalA: number;
  totalB: number;
  /** totalA - totalB. */
  delta: number;
  /** |delta| / max(totalA, totalB, 1), in 0..1. */
  pctDelta: number;
  /** 1 - pctDelta, clamped to 0..1. */
  fairness: number;
  verdict: Verdict;
  winner: "A" | "B" | "even";
}

// Starting thresholds; Backtest B (Task 8) validates and may adjust them once.
const BALANCED_MAX = 0.1;
const SLIGHT_MAX = 0.25;

const sum = (side: PlayerValue[]) => side.reduce((acc, p) => acc + p.value, 0);

export function evaluateTrade(sideA: PlayerValue[], sideB: PlayerValue[]): TradeVerdict {
  const totalA = sum(sideA);
  const totalB = sum(sideB);
  const delta = totalA - totalB;
  const pctDelta = Math.abs(delta) / Math.max(totalA, totalB, 1);
  const fairness = Math.max(0, Math.min(1, 1 - pctDelta));
  const verdict: Verdict =
    pctDelta <= BALANCED_MAX ? "balanced" : pctDelta <= SLIGHT_MAX ? "slight-edge" : "lopsided";
  const winner = verdict === "balanced" ? "even" : delta > 0 ? "A" : "B";
  return { totalA, totalB, delta, pctDelta, fairness, verdict, winner };
}
