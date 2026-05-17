import type { PlayerMarketRecord } from "./governance";

export function reputationEdge(player: PlayerMarketRecord): number {
  return round(player.trueValue - player.perceivedValue + player.ownershipLeverage * 0.18 - player.fragility * 0.08);
}

export function marketInefficiency(player: PlayerMarketRecord): number {
  return round(Math.abs(player.trueValue - player.perceivedValue) * player.confidence + Math.max(0, player.ownershipLeverage) * 0.12);
}

export function narrativeVelocity(player: PlayerMarketRecord): number {
  return round(player.narrativePressure * 0.54 + player.volatility * 0.28 - player.fragility * 0.11);
}

export function chaosExposure(player: PlayerMarketRecord): number {
  return round(player.volatility * 0.45 + player.fragility * 0.4 + Math.abs(player.narrativePressure) * 0.15);
}

export function liquidityScore(player: PlayerMarketRecord): number {
  return round((player.opportunity * 0.6 + marketInefficiency(player) * 0.4) / 10);
}

export function confidenceInterval(center: number, confidence: number): [number, number] {
  const width = (1 - confidence) * 18;
  return [round(Math.max(0, center - width)), round(Math.min(100, center + width))];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
