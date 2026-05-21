export const systems = [
  "Command Center",
  "Market Intelligence",
  "Player Universe",
  "Narrative Engine",
  "Nexus Simulator",
  "Draft Intelligence",
  "Pre-Draft",
  "Waiver Wire",
  "Trade Center",
] as const;

export type SystemName = (typeof systems)[number];

/** Maps each top-level system to the DOM id of its rendered panel section. */
export const SYSTEM_ANCHORS: Record<string, string> = {
  "Command Center": "command-center",
  "Market Intelligence": "market-intelligence",
  "Player Universe": "player-universe",
  "Narrative Engine": "narrative-engine",
  "Nexus Simulator": "nexus-simulator",
  "Draft Intelligence": "draft-intelligence",
  "Pre-Draft": "pre-draft-audit",
  "Waiver Wire": "waiver-wire",
  "Trade Center": "trade-center"
};
