import { describe, expect, it } from "vitest";
import { getGameWeather } from "./openmeteo";

describe("weather adapter", () => {
  it("returns indoor=false weather for outdoor stadium with parsed forecast", async () => {
    const kickoff = new Date("2026-10-11T17:00:00.000Z");
    const fetcher = async () => {
      // Build hourly times around the kickoff so nearestHourIndex finds it.
      const t0 = new Date("2026-10-11T15:00:00.000Z");
      const times = Array.from({ length: 24 }, (_, i) => new Date(t0.getTime() + i * 3_600_000).toISOString());
      return new Response(
        JSON.stringify({
          hourly: {
            time: times,
            temperature_2m: times.map(() => 48),
            precipitation_probability: times.map(() => 10),
            wind_speed_10m: times.map(() => 18),
            wind_gusts_10m: times.map(() => 27)
          }
        }),
        { status: 200 }
      );
    };
    const { weather, source } = await getGameWeather("GB", kickoff, fetcher);
    expect(source.validation).toBe("valid");
    expect(weather?.outdoor).toBe(true);
    expect(weather?.tempF).toBe(48);
    expect(weather?.windMph).toBe(18);
    expect(weather?.windyOrWet).toBe(true);
  });

  it("returns indoor=false signal for dome teams without fetching", async () => {
    const { weather, source } = await getGameWeather("MIN", new Date(), async () => {
      throw new Error("fetcher should not be called for indoor stadium");
    });
    expect(weather?.outdoor).toBe(false);
    expect(weather?.windyOrWet).toBe(false);
    expect(source.source).toContain("indoor");
  });

  it("returns null with unavailable source for unknown team", async () => {
    const { weather, source } = await getGameWeather("ZZZ", new Date());
    expect(weather).toBeNull();
    expect(source.freshness).toBe("unavailable");
  });

  it("returns unavailable on network failure", async () => {
    const fetcher = async () => new Response("oops", { status: 500 });
    const { weather, source } = await getGameWeather("GB", new Date("2026-10-11T17:00:00.000Z"), fetcher);
    expect(weather).toBeNull();
    expect(source.freshness).toBe("unavailable");
  });
});
