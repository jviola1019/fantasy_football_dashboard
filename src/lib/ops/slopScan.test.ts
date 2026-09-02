import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A gate against the generic-template aesthetic, because "don't make it look
 * generated" is a rule the guardrails already state and nothing enforced.
 *
 * CLAUDE.md says RAE must not feel like "a generic Tailwind template" or "a
 * Claude-generated card grid", and must not overuse "neon glow" or "decorative
 * cards". Those are real requirements and they were being met by memory. Memory
 * is how the product ended up with, on 2026-09-01:
 *
 *   - a circular blue → PURPLE gradient avatar in the top bar, the single most
 *     recognisable mark of a generated app, and the only decorative use of
 *     `--purple` in a palette that reserves it for one data encoding;
 *   - an animated three-colour "aurora" gradient drifting behind the empty
 *     state on an 18-second loop;
 *   - a gradient-filled panel under a 32px drop shadow;
 *   - a glowing pill indicator on the mobile navigation;
 *   - every panel, player card and draft row lifting 2px under a 20px
 *     accent-tinted shadow on hover;
 *   - `--panel-shadow`, a shadow tinted with the accent colour;
 *   - two frosted `backdrop-blur-xl` bars;
 *   - a badge and a nav pill at `rounded-full`, in a system whose every other
 *     chip is 3px.
 *
 * WHAT THIS CHECKS AND WHAT IT CANNOT.
 *
 * It checks the mechanical defaults — the specific classes, hexes and
 * properties that appear when a tool reaches for the most common answer. It
 * cannot check whether the result is any good; that stays a human judgement.
 * Nothing here is a proxy for taste, and passing it is not evidence of design
 * quality — it only means the known defaults are not present.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing: the comments recording
 * each removal name the thing that was removed, and a raw scan would read those
 * as the offence itself.
 */

const ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Source with comments removed — and with LINE NUMBERS PRESERVED.
 *
 * A block comment collapses to a single space if you replace it naively, which
 * shifts every line after it. The first run of this gate reported a
 * `backdrop-filter` at `globals.css:178`, where the file has `--space-4: 16px`;
 * the real one was at 288. A finding that points at the wrong line sends the
 * reader looking for a defect that is not there, which is its own small version
 * of the problem this file exists to catch.
 */
function codeOf(file: string): string {
  const raw = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
    " ".repeat(m.length).replace(/ {1}/g, (_c, i: number) => (m[i] === "\n" ? "\n" : " "))
  );
  if (file.endsWith(".css")) return raw;
  return raw
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l))
    .join("\n");
}

const FILES = sourceFiles(join(ROOT, "src"));
const CODE = new Map(FILES.map((f) => [f.slice(ROOT.length + 1).replace(/\\/g, "/"), codeOf(f)]));

interface Rule {
  name: string;
  pattern: RegExp;
  why: string;
  /**
   * Judge each comma-separated SHADOW LAYER rather than the whole match.
   * An `inset` layer is not a glow; a layer beside it can still be one.
   */
  layered?: boolean;
  /**
   * Permitted matches, keyed by path: `{ "src/x.tsx": { "rounded-full": "why" } }`.
   *
   * MATCH-SCOPED, NOT FILE-SCOPED. The first version keyed on path alone and
   * skipped the whole file, and the doc comment above it claimed otherwise. That
   * mattered most for the glow rule, whose one allowance — a focus ring — bought
   * a blanket exemption for the entire 2,500-line stylesheet, the exact file the
   * change had just removed four accent glows from. Caught in review.
   */
  allow?: Record<string, Record<string, string>>;
}

/**
 * Does any layer of this shadow actually GLOW?
 *
 * Three things must be true of a layer, and getting any of them wrong makes the
 * rule useless in one direction or the other:
 *
 *  - **Not `inset`.** An inner shadow is a bevel, not a halo. The first version
 *    tested this with a lookahead spanning the whole value, so an `inset`
 *    anywhere exempted every layer beside it — including an outer glow.
 *  - **Blur above zero.** `0 0 0 1px var(--sidebar-border)` is a hairline border
 *    drawn as a shadow, which `sidebar.tsx` does legitimately and which the
 *    first version flagged. Blur is what makes a glow a glow.
 *  - **A colour that is not grey.** Comparing the three channels catches an
 *    accent tint and dismisses black and white without a special case; a hex or
 *    a `var(--token)` counts as coloured, because every token here is.
 *
 * Handles CSS (`box-shadow: …`, space-separated) and Tailwind arbitrary values
 * (`shadow-[0_4px_20px_rgba(…)]`, underscore-separated) alike.
 */
function isGlow(declaration: string): boolean {
  const value = declaration
    .replace(/^[^:[]*[:[]/, "")
    .replace(/\]$/, "")
    .replace(/_/g, " ");
  for (const layer of splitLayers(value)) {
    if (/\binset\b/.test(layer)) continue;
    // <offset-x> <offset-y> [blur] [spread] — no third length means no blur.
    //
    // The colour is removed FIRST. Two lengths in a shadow are conventionally
    // written unitless (`0 0 20px rgba(…)`), so the numbers cannot be matched by
    // requiring a unit — and without stripping the colour, `rgba(90,159,196,0.5)`
    // contributes four more "numbers" and every shadow looks like it has a blur.
    // A first version required units, found one length in `0 0 20px rgba(…)`,
    // concluded blur = 0, and passed the glow it was written to catch.
    const geometry = layer.replace(/(?:rgba?|hsla?|var)\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g, " ");
    const lengths = geometry.match(/-?[\d.]+(?:px|rem|em)?/g) ?? [];
    const blur = lengths.length >= 3 ? parseFloat(lengths[2]!) : 0;
    if (!(blur > 0)) continue;
    const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(layer);
    if (rgb) {
      const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
      if (r !== g || g !== b) return true;
      continue;
    }
    if (/#[0-9a-fA-F]{3,8}\b/.test(layer)) return true;
    if (/var\(--/.test(layer)) return true;
  }
  return false;
}

/** Split a shadow value on commas that are not inside parentheses. */
function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Build a class attribute that Tailwind's scanner cannot read.
 *
 * SCANNER-OPAQUE ON PURPOSE. Tailwind v4's automatic source detection reads this
 * file, and the canary samples below were written as realistic class attributes
 * so each rule could be shown to match one. Tailwind read them as usage and
 * compiled them: the shipped stylesheet carried `.from-indigo-500`,
 * `.to-purple-600`, `.rounded-2xl`, `.shadow-2xl` and the theme variables
 * `--color-indigo-500` / `--color-purple-600`, none of which appears anywhere in
 * the product. The gate that bans indigo and purple was the sole reason they
 * were in the stylesheet — and `className="to-purple-600"` would then have
 * rendered, with only this test between it and production.
 *
 * `globals.css` now excludes tests from source detection as well. Splitting the
 * strings too means neither fix is load-bearing on its own.
 */
const cls = (name: string) => `class` + `Name="${name}"`;

const RULES: Rule[] = [
  {
    name: "Inter / Roboto / Arial in a font stack",
    pattern: /font-family:[^;{]*\b(Inter|Roboto|Arial)\b/g,
    why: "the default typeface of a generated page. RAE uses Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono."
  },
  {
    name: "the template blue and its neighbours",
    pattern: /#(2563[Ee][Bb]|3[Bb]82[Ff]6|6366[Ff]1|8[Bb]5[Cc][Ff]6|[Aa]855[Ff]7)\b/g,
    why: "Tailwind blue-600 / blue-500 / indigo-500 / violet-500 / purple-500. RAE's accent is --blue #5a9fc4."
  },
  {
    name: "indigo / violet / purple / fuchsia utilities",
    pattern: /\b(?:from|via|to|bg|text|border|ring|shadow)-(?:indigo|violet|purple|fuchsia)-\d{2,3}\b/g,
    why: "the purple half of the blue-purple default. --purple exists here for ONE data encoding and is used by name."
  },
  {
    name: "gradient utilities",
    pattern: /\bbg-gradient-to-[a-z]+\b/g,
    why: "a gradient surface. Panels here are flat; a gradient makes an element's contrast depend on where content sits on it."
  },
  {
    name: "oversized radii",
    pattern: /\brounded-(?:2xl|3xl)\b/g,
    why: "16px+ corners on a data panel. The system's radii are 2-8px."
  },
  {
    name: "pill radii",
    pattern: /\brounded-full\b|border-radius:\s*(?:999|9999)px/g,
    why: "a pill. Every chip in this product is 3px; a pill reads as a different design system.",
    allow: {
      "src/components/governance/ModeBanner.tsx": {
        "rounded-full": "a 6px live-state DOT (h-1.5 w-1.5) — a dot is a circle, not a pill"
      }
    }
  },
  {
    name: "frosted bars",
    pattern: /\bbackdrop-blur[\w-]*\b|backdrop-filter:/g,
    why: "glassmorphism. It costs a compositor layer per scroll frame and makes a bar's legibility depend on what scrolls behind it."
  },
  {
    name: "dramatic shadows",
    // Tailwind arbitrary values separate lengths with `_`, which is a word
    // character — so a `\b` before the digits never matches inside one.
    pattern: /\bshadow-(?:xl|2xl)\b|box-shadow:[^;]*(?:^|[\s_])(?:2[0-9]|[3-9][0-9])px\s+rgba|\bshadow-\[[^\]]*[\s_](?:2[0-9]|[3-9][0-9])px/g,
    why: "a floating-card shadow. These panels tile; they do not float."
  },
  {
    name: "accent-tinted shadows (glow)",
    // A shadow whose colour is not neutral is modelling something other than
    // light. Matched per DECLARATION here; `glowLayers()` below then splits it
    // into layers and judges each one, because the first version put the `inset`
    // exclusion in a lookahead over the whole value — so `inset` ANYWHERE in a
    // multi-layer shadow exempted every layer, outer glow included. It also only
    // understood `rgba(...)` numerics, so a hex or a `var()` glow walked past,
    // and it flagged neutral white as "accent-tinted". Caught in review.
    pattern: /box-shadow:[^;{]*|shadow-\[[^\]]*\]/g,
    why: "a coloured shadow is a glow. The guardrails permit RESTRAINED glow, not a halo on every hoverable row.",
    layered: true,
    allow: {
      "src/app/globals.css": {
        "box-shadow: 0 0 0 2px rgba(74, 140, 247, .12)":
          "the focus ring — a 2px accent ring IS the visible focus state WCAG 2.4.7 requires"
      }
    }
  },
  {
    name: "hover lift",
    pattern: /:hover\s*\{[^}]*transform:\s*translateY\(-/g,
    why: "the card-lifts-on-hover interaction. A 2px jump under the cursor makes a dense list feel unstable to read."
  },
  {
    name: "animated background gradients",
    pattern: /animation:[^;]*\b(?:aurora|shimmer|gradient)[\w-]*/gi,
    why: "an ambient animated gradient. Movement that tells the reader nothing."
  },
  {
    name: "AI page-builder fingerprints",
    pattern: /\b(?:durable\.co|mixo\.io|v0\.dev|lovable\.dev|framer\.website)\b/g,
    why: "a builder's own signature left in the output."
  }
];

describe("the UI does not fall back to the generated-page defaults", () => {
  it("has files to scan, so a broken scan cannot pass vacuously", () => {
    expect(CODE.size).toBeGreaterThan(100);
    expect([...CODE.values()].join("").length).toBeGreaterThan(400_000);
  });

  it.each(RULES.map((r) => [r.name, r] as const))("%s", (_name, rule) => {
    const found: string[] = [];
    for (const [path, code] of CODE) {
      if (path.endsWith("slopScan.test.ts")) continue; // its own patterns
      const permitted = rule.allow?.[path];
      for (const m of code.matchAll(rule.pattern)) {
        const text = m[0].trim();
        if (permitted && Object.keys(permitted).some((k) => text.startsWith(k))) continue;
        if (rule.layered && !isGlow(text)) continue;
        const line = code.slice(0, m.index).split("\n").length;
        found.push(`${path}:${line}  ${text.slice(0, 70)}`);
      }
    }
    expect(found, `${rule.why}\n${found.join("\n")}`).toEqual([]);
  });

  it("every allowance names a match that is still there", () => {
    // An allowance for something that has been removed is dead weight, and it
    // hides whether the exception was ever needed. Checked per MATCH now, so an
    // allowance cannot outlive the one declaration it was written for.
    for (const rule of RULES) {
      for (const [path, matches] of Object.entries(rule.allow ?? {})) {
        const code = CODE.get(path);
        expect(code, `${rule.name} allows ${path}, which no longer exists`).toBeDefined();
        for (const text of Object.keys(matches)) {
          expect(
            (code ?? "").includes(text),
            `${rule.name} allows "${text}" in ${path}, which no longer contains it — drop the allowance`
          ).toBe(true);
        }
      }
    }
  });

  it("detects every pattern it bans", () => {
    // Canary. A rule that matches nothing is indistinguishable from a clean
    // tree, and this repository has shipped four vacuous guards.
    const samples: Array<[string, string]> = [
      ["Inter / Roboto / Arial in a font stack", "font-family: Inter, sans-serif;"],
      ["the template blue and its neighbours", "color: #2563eb;"],
      ["indigo / violet / purple / fuchsia utilities", cls("from-indi" + "go-500 to-pur" + "ple-600")],
      ["gradient utilities", cls("bg-gradi" + "ent-to-br from-a to-b")],
      ["oversized radii", cls("round" + "ed-2xl")],
      ["pill radii", cls("round" + "ed-full")],
      ["frosted bars", cls("backdrop-" + "blur-xl")],
      ["dramatic shadows", cls("shad" + "ow-2xl")],
      ["accent-tinted shadows (glow)", "box-shadow: 0 0 20px rgba(90,159,196,0.5), inset 0 0 0 1px rgba(0,0,0,0.4);"],
      ["dramatic shadows", cls("shad" + "ow-[0_4px_32px_rgba(0,0,0,0.4)]")],
      ["hover lift", ".card:hover { transform: translateY(-2px); }"],
      ["animated background gradients", "animation: aurora-shift 18s ease-in-out infinite;"],
      ["AI page-builder fingerprints", "generated by v0.dev"]
    ];
    for (const [name, sample] of samples) {
      const rule = RULES.find((r) => r.name === name)!;
      const hits = [...sample.matchAll(rule.pattern)].filter(
        (m) => !rule.layered || isGlow(m[0].trim())
      );
      expect(hits.length, `rule "${name}" did not match its own canary`).toBeGreaterThan(0);
    }
    // EVERY rule needs at least one canary; some need more than one, because a
    // rule with several alternations can have a live half and a dead half. The
    // glow rule earns two — a single-layer glow and the multi-layer case its
    // first implementation missed entirely.
    const covered = new Set(samples.map(([name]) => name));
    const uncovered = RULES.map((r) => r.name).filter((n) => !covered.has(n));
    expect(uncovered, `no canary for: ${uncovered.join(", ")}`).toEqual([]);
  });

  it("does not fire on the things it must not", () => {
    // The opposite failure: a rule so broad it bans legitimate work.
    const legitimate: Array<[string, string]> = [
      ["accent-tinted shadows (glow)", "box-shadow: inset 3px 0 0 var(--blue);"],
      // A hairline border drawn as a shadow: zero blur, so not a glow.
      ["accent-tinted shadows (glow)", cls("shad" + "ow-[0_0_0_1px_var(--sidebar-border)]")],
      // Neutral outer layer, accent layer INSET — the multi-layer case the
      // original lookahead got backwards.
      ["accent-tinted shadows (glow)", "box-shadow: 0 2px 8px rgba(0,0,0,0.4), inset 0 0 0 1px var(--blue);"],
      ["dramatic shadows", "box-shadow: 0 2px 4px rgba(0,0,0,0.4);"],
      ["the template blue and its neighbours", "color: #5a9fc4;"],
      ["pill radii", "border-radius: 3px;"],
      ["gradient utilities", "background: radial-gradient(circle, rgba(74,141,183,0.32) 1px, transparent 1px);"]
    ];
    for (const [name, sample] of legitimate) {
      const rule = RULES.find((r) => r.name === name)!;
      // Mirror the matcher exactly, `layered` included. A layered rule's PATTERN
      // deliberately matches every `box-shadow:`; `isGlow` is what decides. A
      // test that checked only the pattern would be testing a different function
      // from the one that runs, and would have failed here for the right answer.
      const hits = [...sample.matchAll(rule.pattern)].filter(
        (m) => !rule.layered || isGlow(m[0].trim())
      );
      expect(hits.length, `rule "${name}" fired on legitimate code`).toBe(0);
    }
  });
});

/**
 * The copy half.
 *
 * These are the words that appear when prose is generated rather than written.
 * The list is deliberately short and specific: banning "important" would be
 * censorship of ordinary English, while "unlock the power of" has exactly one
 * provenance.
 */
const COPY_MARKERS: Array<[string, RegExp]> = [
  ["unlock the power/potential", /unlock the (?:power|potential)/i],
  ["in today's fast-paced …", /in today'?s\s+\S+(?:\s+\S+)?\s*(?:world|landscape|market|environment)/i],
  ["delve", /\bdelv(?:e|es|ing)\b/i],
  ["tapestry", /\btapestry\b/i],
  ["realm of", /\brealm of\b/i],
  ["game-changer", /\bgame[- ]?chang(?:er|ing)\b/i],
  ["cutting-edge", /\bcutting[- ]edge\b/i],
  ["state of the art", /\bstate[- ]of[- ]the[- ]art\b/i],
  ["revolutionise", /\brevolutioni[sz](?:e|es|ing|ed)\b/i],
  ["supercharge", /\bsuperchar(?:ge|ged|ging)\b/i],
  ["take it to the next level", /\bnext[- ]level\b|\bto the next level\b/i],
  ["best/world-class", /\b(?:best|world)[- ]in[- ]class\b|\bworld[- ]class\b/i],
  ["elevate your", /\belevate your\b/i],
  ["seamless", /\bseamless(?:ly)?\b/i],
  ["ever-evolving", /\bever[- ]evolving\b/i],
  ["synergy", /\bsynerg(?:y|ies|istic)\b/i],
  ["paradigm", /\bparadigm\b/i],
  ["build the future", /\bbuild the future\b/i],
  ["hedged nothing-claim", /\b(?:might potentially|could be worth considering)\b/i]
];

describe("the stylesheet cannot be compiled out of prose", () => {
  /**
   * Tailwind v4 detects sources automatically across the whole repository minus
   * gitignored paths, and it reads markdown as readily as TSX. So a document
   * that NAMES a banned utility compiles it into the shipped stylesheet.
   *
   * Measured 2026-09-02: the production CSS contained `.from-indigo-500`,
   * `.to-purple-600`, a 16px radius, a 2xl shadow, and the indigo and purple
   * theme variables that make them available — and every one traced to this
   * file's canary list, to CLAUDE.md, or to the session report arguing AGAINST
   * them. The gate that bans indigo and purple was the sole reason they were in
   * the product's stylesheet, and `className` with one of those utilities would
   * then have rendered.
   *
   * This test pins the exclusions. It cannot see the build — `e2e/27-ui-audit`
   * checks the compiled artefact, which is the half that proves the exclusions
   * work rather than merely that they are written down.
   */
  const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

  it.each([
    ["unit tests", "../**/*.test.*"],
    ["the e2e suite", "../../e2e/**"],
    ["markdown", "../../**/*.md"],
    ["reports", "../../reports/**"],
    ["docs", "../../docs/**"],
    ["playwright artifacts", "../../test-results/**"]
  ])("excludes %s from Tailwind source detection", (_label, pattern) => {
    expect(
      css.includes(`@source not "${pattern}"`),
      `globals.css must carry \`@source not "${pattern}"\`, or prose naming a ` +
        `utility class will compile that class into the shipped stylesheet.`
    ).toBe(true);
  });

  it("still lets Tailwind see the components", () => {
    // The opposite failure: narrowing detection so far that real classes vanish
    // and the UI silently loses its styling. Nothing may exclude src/app or
    // src/components.
    for (const bad of ['@source not "."', '@source not "../components"', 'source(none)']) {
      expect(css.includes(bad), `${bad} would blind Tailwind to real components`).toBe(false);
    }
  });
});

describe("the copy is written, not generated", () => {
  /** Only files that produce user-visible text. */
  const COPY_FILES = [...CODE.entries()].filter(
    ([p]) => p.endsWith(".tsx") && !p.includes(".test.")
  );

  it("has copy to scan", () => {
    expect(COPY_FILES.length).toBeGreaterThan(30);
  });

  it.each(COPY_MARKERS)("avoids %s", (name, pattern) => {
    const found: string[] = [];
    for (const [path, code] of COPY_FILES) {
      const m = pattern.exec(code);
      if (m) found.push(`${path}: …${code.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}…`);
    }
    expect(
      found,
      `"${name}" is marketing filler. Say the specific thing instead:\n${found.join("\n")}`
    ).toEqual([]);
  });

  it("detects the phrases it bans", () => {
    // Canary, one per marker — a dead regex here would silently license the lot.
    const samples = [
      "unlock the power of your roster",
      "In today's fast-paced fantasy world",
      "let us delve into the numbers",
      "a rich tapestry of data",
      "in the realm of analytics",
      "a real game-changer",
      "cutting-edge modelling",
      "state-of-the-art projections",
      "revolutionizing fantasy football",
      "supercharge your draft",
      "take your roster to the next level",
      "world-class analytics",
      "elevate your lineup",
      "a seamless experience",
      "the ever-evolving market",
      "unlock synergy across your roster",
      "a new paradigm",
      "we build the future of fantasy",
      "this might potentially help"
    ];
    expect(samples.length).toBe(COPY_MARKERS.length);
    for (let i = 0; i < samples.length; i += 1) {
      expect(samples[i], `marker "${COPY_MARKERS[i]![0]}" did not match its canary`).toMatch(
        COPY_MARKERS[i]![1]
      );
    }
  });

  it("leaves domain vocabulary alone", () => {
    // `ownershipLeverage` is a real model field, and "leverage" in that sense is
    // not filler — which is exactly why the generic word is NOT on the list.
    // This pins that decision so nobody "completes" the list later and breaks
    // the product's own vocabulary.
    for (const [, pattern] of COPY_MARKERS) {
      expect("true minus market value, adjusted for ownership leverage and fragility").not.toMatch(pattern);
      expect("the validated harness reproduces the published Brier score").not.toMatch(pattern);
    }
  });
});
