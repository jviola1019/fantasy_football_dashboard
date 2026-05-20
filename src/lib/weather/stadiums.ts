export interface Stadium {
  team: string;
  name: string;
  lat: number;
  lon: number;
  /** Outdoor stadiums are weather-sensitive; domes/retractables effectively are not. */
  outdoor: boolean;
}

/**
 * Public NFL stadium coordinates. Used only as inputs to open-meteo's free
 * weather API; no proprietary data. Coordinates are accurate to within ~200m,
 * which is far below the resolution of the forecast model.
 */
export const NFL_STADIUMS: Record<string, Stadium> = {
  ARI: { team: "ARI", name: "State Farm Stadium",       lat: 33.5276, lon: -112.2626, outdoor: false },
  ATL: { team: "ATL", name: "Mercedes-Benz Stadium",    lat: 33.7553, lon: -84.4006,  outdoor: false },
  BAL: { team: "BAL", name: "M&T Bank Stadium",         lat: 39.2780, lon: -76.6227,  outdoor: true  },
  BUF: { team: "BUF", name: "Highmark Stadium",         lat: 42.7738, lon: -78.7869,  outdoor: true  },
  CAR: { team: "CAR", name: "Bank of America Stadium",  lat: 35.2258, lon: -80.8528,  outdoor: true  },
  CHI: { team: "CHI", name: "Soldier Field",            lat: 41.8623, lon: -87.6167,  outdoor: true  },
  CIN: { team: "CIN", name: "Paycor Stadium",           lat: 39.0954, lon: -84.5160,  outdoor: true  },
  CLE: { team: "CLE", name: "Cleveland Browns Stadium", lat: 41.5061, lon: -81.6995,  outdoor: true  },
  DAL: { team: "DAL", name: "AT&T Stadium",             lat: 32.7473, lon: -97.0945,  outdoor: false },
  DEN: { team: "DEN", name: "Empower Field",            lat: 39.7439, lon: -105.0201, outdoor: true  },
  DET: { team: "DET", name: "Ford Field",               lat: 42.3400, lon: -83.0456,  outdoor: false },
  GB:  { team: "GB",  name: "Lambeau Field",            lat: 44.5013, lon: -88.0622,  outdoor: true  },
  HOU: { team: "HOU", name: "NRG Stadium",              lat: 29.6847, lon: -95.4107,  outdoor: false },
  IND: { team: "IND", name: "Lucas Oil Stadium",        lat: 39.7601, lon: -86.1639,  outdoor: false },
  JAX: { team: "JAX", name: "EverBank Stadium",         lat: 30.3239, lon: -81.6373,  outdoor: true  },
  KC:  { team: "KC",  name: "GEHA Field at Arrowhead",  lat: 39.0490, lon: -94.4839,  outdoor: true  },
  LV:  { team: "LV",  name: "Allegiant Stadium",        lat: 36.0908, lon: -115.1830, outdoor: false },
  LAC: { team: "LAC", name: "SoFi Stadium",             lat: 33.9534, lon: -118.3387, outdoor: false },
  LAR: { team: "LAR", name: "SoFi Stadium",             lat: 33.9534, lon: -118.3387, outdoor: false },
  MIA: { team: "MIA", name: "Hard Rock Stadium",        lat: 25.9580, lon: -80.2389,  outdoor: true  },
  MIN: { team: "MIN", name: "U.S. Bank Stadium",        lat: 44.9737, lon: -93.2581,  outdoor: false },
  NE:  { team: "NE",  name: "Gillette Stadium",         lat: 42.0909, lon: -71.2643,  outdoor: true  },
  NO:  { team: "NO",  name: "Caesars Superdome",        lat: 29.9509, lon: -90.0815,  outdoor: false },
  NYG: { team: "NYG", name: "MetLife Stadium",          lat: 40.8135, lon: -74.0744,  outdoor: true  },
  NYJ: { team: "NYJ", name: "MetLife Stadium",          lat: 40.8135, lon: -74.0744,  outdoor: true  },
  PHI: { team: "PHI", name: "Lincoln Financial Field",  lat: 39.9008, lon: -75.1675,  outdoor: true  },
  PIT: { team: "PIT", name: "Acrisure Stadium",         lat: 40.4467, lon: -80.0158,  outdoor: true  },
  SF:  { team: "SF",  name: "Levi's Stadium",           lat: 37.4030, lon: -121.9698, outdoor: true  },
  SEA: { team: "SEA", name: "Lumen Field",              lat: 47.5952, lon: -122.3316, outdoor: true  },
  TB:  { team: "TB",  name: "Raymond James Stadium",    lat: 27.9759, lon: -82.5033,  outdoor: true  },
  TEN: { team: "TEN", name: "Nissan Stadium",           lat: 36.1665, lon: -86.7713,  outdoor: true  },
  WSH: { team: "WSH", name: "Northwest Stadium",        lat: 38.9077, lon: -76.8645,  outdoor: true  }
};

export function getStadium(team: string): Stadium | null {
  return NFL_STADIUMS[team.toUpperCase()] ?? null;
}
