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
