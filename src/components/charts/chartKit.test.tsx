import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "./BarChart";
import { Heatmap2D } from "./Heatmap2D";
import { ReliabilityDiagram } from "./ReliabilityDiagram";
import { describeReliability } from "./describeReliability";
import type { ReliabilityBin } from "@/lib/stats/distribution";

/**
 * S5 — the chart kit.
 *
 * The two rules these enforce, both learned the hard way:
 *
 *   1. NO CHART SETS TYPE IN SVG USER UNITS. A `fontSize` inside a `viewBox`
 *      scales with the container, so a 10px label rendered at 7.1px inside a
 *      mini-panel and no CSS could reach it. Charts whose text is data are HTML.
 *   2. A CHART'S TEXT ALTERNATIVE DESCRIBES THE DATA, NOT THE AXES. The
 *      reliability diagram's label was a constant string, identical for a
 *      perfectly calibrated model and one with no data at all.
 */

describe("BarChart is HTML, so its labels obey the type scale", () => {
  const html = renderToStaticMarkup(
    <BarChart
      items={[
        { label: "Chase", value: 14 },
        { label: "Barkley", value: 13.8 }
      ]}
      valueSuffix=""
    />
  );

  it("emits no <svg> and no SVG font sizing at all", () => {
    // The regression this exists to catch: reverting to SVG silently
    // reintroduces sub-floor type that only a rendered-pixel measurement sees.
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/fontSize|font-size/i);
  });

  it("puts every label and value in the DOM as real text", () => {
    expect(html).toContain("Chase");
    expect(html).toContain("14");
    expect(html).toContain("Barkley");
    expect(html).toContain("13.8");
  });

  it("gives each bar a text alternative naming its own value", () => {
    expect(html).toContain('aria-label="Chase: 14"');
  });

  it("scales bar width against the max, and floors a non-zero bar so it stays visible", () => {
    const out = renderToStaticMarkup(
      <BarChart items={[{ label: "big", value: 100 }, { label: "tiny", value: 0.01 }]} max={100} />
    );
    expect(out).toContain("--bar-pct:100%");
    // 0.01% of the track would be invisible; floored to 1.5%.
    expect(out).toContain("--bar-pct:1.5%");
  });

  it("renders a true zero as an empty track rather than a floored one", () => {
    const out = renderToStaticMarkup(<BarChart items={[{ label: "none", value: 0 }]} max={10} />);
    expect(out).toContain("--bar-pct:0%");
  });
});

describe("Heatmap2D is a table, so every cell is addressable", () => {
  const html = renderToStaticMarkup(
    <Heatmap2D
      data={[
        [0.1, 0.9],
        [0.5, 0.2]
      ]}
      xLabels={["6 wins", "7 wins"]}
      yLabels={["Champion", "Playoff"]}
      caption="P(outcome | wins); each column sums to 100%."
      rowAxisLabel="Outcome"
      colAxisLabel="Wins"
    />
  );

  it("is a real table with scoped headers on both axes", () => {
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it("writes the value into the cell, so colour is redundant not load-bearing", () => {
    // WCAG 1.4.1: information must not be conveyed by colour alone.
    expect(html).toContain("10%");
    expect(html).toContain("90%");
    expect(html).toContain("50%");
    expect(html).toContain("20%");
  });

  it("keeps the misread-prevention caption, and does not announce it twice", () => {
    expect(html).toContain("each column sums to 100%");
    // Once as <caption> for AT, once visually with aria-hidden.
    expect(html).toContain('aria-hidden="true"');
  });

  it("emits no SVG font sizing", () => {
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/fontSize/);
  });
});

describe("describeReliability says what the chart shows", () => {
  const bin = (meanForecast: number, observedFreq: number, n: number): ReliabilityBin => ({
    binCenter: meanForecast,
    meanForecast,
    observedFreq,
    n
  });

  it("names the absence of data instead of implying a result", () => {
    expect(describeReliability(undefined)).toContain("No backtest has been run");
    expect(describeReliability([])).toContain("No backtest has been run");
  });

  it("reports a perfectly calibrated forecaster as having no directional error", () => {
    const out = describeReliability([bin(0.2, 0.2, 50), bin(0.8, 0.8, 50)]);
    expect(out).toContain("0.0%");
    expect(out).toContain("no consistent direction");
  });

  it("calls it over-confident when outcomes happen LESS often than forecast", () => {
    // Forecast 80%, happened 60% — the forecaster claimed too much.
    const out = describeReliability([bin(0.8, 0.6, 100)]);
    expect(out).toContain("over-confident");
    expect(out).toContain("20.0% less often than forecast");
  });

  it("calls it under-confident when outcomes happen MORE often than forecast", () => {
    const out = describeReliability([bin(0.2, 0.4, 100)]);
    expect(out).toContain("under-confident");
    expect(out).toContain("20.0% more often");
  });

  it("weights bins by n, so a three-forecast bin cannot outvote a three-hundred one", () => {
    // Unweighted these average to a 10% gap. Weighted by n the large,
    // well-calibrated bin dominates: (300*0 + 3*0.2)/303 = 0.198%.
    const out = describeReliability([bin(0.5, 0.5, 300), bin(0.8, 1.0, 3)]);
    expect(out).toContain("0.2%");
    expect(out).not.toContain("10.0%");
  });

  it("reports every bin's own numbers, which role=img had made unreachable", () => {
    const out = describeReliability([bin(0.25, 0.3, 40)]);
    expect(out).toContain("forecast 25.0% observed 30.0% (n=40)");
  });
});

describe("ReliabilityDiagram carries that summary into the DOM", () => {
  it("puts a data-derived summary in a figcaption, not a static aria-label", () => {
    const html = renderToStaticMarkup(
      <ReliabilityDiagram
        bins={[{ binCenter: 0.8, meanForecast: 0.8, observedFreq: 0.6, n: 100 }]}
      />
    );
    expect(html).toContain("<figcaption");
    expect(html).toContain("over-confident");
    // The old constant label must not come back.
    expect(html).not.toContain("observed frequency vs mean forecast probability");
  });

  it("hides the graphic from AT so the summary is the single description", () => {
    const html = renderToStaticMarkup(<ReliabilityDiagram bins={[]} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("No backtest has been run");
  });
});
