import { z } from "zod";
import { fetchWithEnvelope, type Fetcher } from "../http";
import { getStadium } from "./stadiums";
import type { SourceMeta } from "../governance";

const OPENMETEO_BASE = "https://api.open-meteo.com/v1/forecast";
const WEATHER_TTL = 60 * 60; // 1h — the cron is meant to refresh hourly during game days.

const OpenMeteoForecastSchema = z
  .object({
    hourly: z
      .object({
        time: z.array(z.string()),
        temperature_2m: z.array(z.number()).optional(),
        precipitation_probability: z.array(z.number()).optional(),
        wind_speed_10m: z.array(z.number()).optional(),
        wind_gusts_10m: z.array(z.number()).optional()
      })
      .passthrough()
  })
  .passthrough();

export type OpenMeteoForecast = z.infer<typeof OpenMeteoForecastSchema>;

export interface GameWeather {
  team: string;
  stadium: string;
  outdoor: boolean;
  kickoffIso: string;
  tempF: number | null;
  windMph: number | null;
  gustsMph: number | null;
  precipPct: number | null;
  /** True if conditions are likely to suppress passing offenses. */
  windyOrWet: boolean;
}

export interface GetGameWeatherResult {
  weather: GameWeather | null;
  source: SourceMeta;
}

/**
 * Fetch hourly forecast for an NFL stadium at a kickoff time. Returns null + an
 * `unavailable` envelope when we can't get a reading; never fabricates.
 */
export async function getGameWeather(
  team: string,
  kickoff: Date,
  fetcher?: Fetcher
): Promise<GetGameWeatherResult> {
  const stadium = getStadium(team);
  if (!stadium) {
    return {
      weather: null,
      source: unavailable(`unknown stadium for team ${team}`)
    };
  }
  // Indoor stadiums: don't bother fetching; the answer is "doesn't matter."
  if (!stadium.outdoor) {
    return {
      weather: {
        team: stadium.team,
        stadium: stadium.name,
        outdoor: false,
        kickoffIso: kickoff.toISOString(),
        tempF: null,
        windMph: null,
        gustsMph: null,
        precipPct: null,
        windyOrWet: false
      },
      source: {
        source: "Open-Meteo (indoor stadium — no fetch)",
        fetchedAt: new Date().toISOString(),
        ttlSeconds: WEATHER_TTL,
        freshness: "fresh",
        confidence: 1.0,
        validation: "valid",
        missingFields: [],
        assumptions: ["Indoor stadium; outdoor weather signal is irrelevant."],
        failure: null
      }
    };
  }

  const url = `${OPENMETEO_BASE}?latitude=${stadium.lat}&longitude=${stadium.lon}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=4`;

  const { data, source } = await fetchWithEnvelope({
    url,
    schema: OpenMeteoForecastSchema,
    source: `Open-Meteo forecast for ${stadium.team}`,
    ttlSeconds: WEATHER_TTL,
    fetcher,
    assumptions: ["Open-Meteo is free and unauthenticated; coverage is best-effort."]
  });

  if (!data) {
    return { weather: null, source };
  }

  const hourlyIdx = nearestHourIndex(data.hourly.time, kickoff);
  if (hourlyIdx == null) {
    return {
      weather: null,
      source: { ...source, freshness: "missing", failure: "kickoff falls outside forecast window" }
    };
  }

  const tempF = data.hourly.temperature_2m?.[hourlyIdx] ?? null;
  const windMph = data.hourly.wind_speed_10m?.[hourlyIdx] ?? null;
  const gustsMph = data.hourly.wind_gusts_10m?.[hourlyIdx] ?? null;
  const precipPct = data.hourly.precipitation_probability?.[hourlyIdx] ?? null;

  const windyOrWet = (windMph ?? 0) >= 15 || (precipPct ?? 0) >= 50;

  return {
    weather: {
      team: stadium.team,
      stadium: stadium.name,
      outdoor: true,
      kickoffIso: kickoff.toISOString(),
      tempF,
      windMph,
      gustsMph,
      precipPct,
      windyOrWet
    },
    source
  };
}

function nearestHourIndex(times: string[], target: Date): number | null {
  if (times.length === 0) return null;
  let bestIdx = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  const targetMs = target.getTime();
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]!);
    if (Number.isNaN(t)) continue;
    const delta = Math.abs(t - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  // Reject if the nearest sample is more than 2h away — out of forecast range.
  if (bestIdx === -1 || bestDelta > 2 * 60 * 60 * 1000) return null;
  return bestIdx;
}

function unavailable(failure: string): SourceMeta {
  return {
    source: "Open-Meteo",
    fetchedAt: null,
    ttlSeconds: WEATHER_TTL,
    freshness: "unavailable",
    confidence: 0,
    validation: "not-run",
    missingFields: ["forecast"],
    assumptions: [],
    failure
  };
}
