/**
 * The in-page half of `scripts/audit-ui.ts`, kept here so the parts that are
 * pure arithmetic can be unit-tested without a browser.
 *
 * The colour maths is the part worth testing. Compositing is where the
 * `--blue`-at-opacity-.75 bug hid: every automated check read `color` and
 * reported 5.6:1, while the compositor painted 4.13:1. If this module's
 * `contrastRatio`/`compositeOver` were wrong, the audit built on top of it would
 * be one more green check that is not checking.
 */

/** The spacing scale declared in `globals.css`. */
export const SPACE_SCALE = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export interface UiFinding {
  kind: "spacing" | "tabbing" | "opacity" | "model-output";
  detail: string;
  selector: string;
  route?: string;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse the `rgb()` / `rgba()` form every browser returns from getComputedStyle. */
export function parseRgba(value: string): Rgba | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1]!.split(",").map((x) => parseFloat(x));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts.length > 3 ? parts[3]! : 1 };
}

/** Source-over compositing: what the screen shows when `fg` is painted on `bg`. */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  };
}

/** WCAG relative luminance. */
export function relativeLuminance(c: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1:1 to 21:1. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The contrast a reader actually gets, given an `opacity` somewhere up the tree.
 *
 * This is the whole point of the module. `opacity` is not part of `color`, so a
 * checker that reads `color` alone reports the undimmed ratio and passes.
 */
export function effectiveContrast(fg: Rgba, bg: Rgba, opacity: number): number {
  const painted = compositeOver({ ...fg, a: fg.a * opacity }, bg);
  return contrastRatio(painted, bg);
}

/** WCAG 1.4.3 threshold for a given rendered size. */
export function requiredContrast(fontSizePx: number, bold: boolean): 3 | 4.5 {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && bold);
  return large ? 3 : 4.5;
}

/** Is a used px value off the declared spacing scale? */
export function isOffScale(px: number): boolean {
  if (!Number.isFinite(px) || px === 0) return false;
  return !SPACE_SCALE.some((s) => Math.abs(s - px) < 0.51);
}

/**
 * Wait for entrance animations to finish before measuring anything.
 *
 * Audit 2026-08-24. The scan reported twelve contrast failures on `/analytics`
 * at mobile width — `opacity 0.69` compositing to 3.60:1 — and every one was a
 * frame of `card-fade-in` (`opacity 0→1`, 200ms, staggered per card). The
 * settled style passes; the audit was reading the reveal. 0.69 is not a value
 * anybody writes, which is what gave it away.
 *
 * Reporting a transient frame as a defect is a false accusation, and a checker
 * that cries wolf gets ignored — the same failure as the 169 target-size
 * findings that ignored WCAG's spacing exception.
 *
 * INFINITE animations are excluded deliberately: the live-status blink and pulse
 * never finish, so awaiting them would hang forever. Resolves `false` on timeout
 * rather than throwing, so the caller can say the measurement is unsettled
 * instead of silently reporting whatever it happened to catch.
 */
export const WAIT_FOR_ANIMATIONS = `(() => new Promise((resolve) => {
  const HARD_LIMIT_MS = 5000;
  const start = Date.now();
  const pending = () => document.getAnimations().filter((a) => {
    const timing = a.effect && a.effect.getComputedTiming();
    return timing && timing.iterations !== Infinity && a.playState !== "finished";
  });

  // Looping, not a single await. A first version awaited whatever getAnimations()
  // returned at one instant and was FLAKY: staggered reveals carry an
  // animation-delay, and an element that mounts a frame later has not registered
  // its animation yet, so the snapshot came back empty and the scan measured a
  // fade in progress. A gate that fails one run in three is worse than no gate.
  const settle = () => {
    if (Date.now() - start > HARD_LIMIT_MS) { resolve(false); return; }
    const running = pending();
    if (running.length === 0) {
      // Nothing running now — but give it a frame in case something is starting.
      requestAnimationFrame(() => {
        if (pending().length === 0) resolve(true);
        else settle();
      });
      return;
    }
    Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(settle);
  };

  // Two frames first, so anything mounting on this tick has registered.
  requestAnimationFrame(() => requestAnimationFrame(settle));
  setTimeout(() => resolve(false), HARD_LIMIT_MS + 500);
}))()`;

/**
 * The browser-side scan, as a string because it is evaluated in the page.
 *
 * It is assembled from the exported helpers above rather than duplicating them,
 * so the arithmetic the unit tests cover is the arithmetic that runs.
 */
export const IN_PAGE_AUDIT = `(() => {
  // esbuild (via tsx) wraps named inner functions as \`__name(fn, "fn")\` to keep
  // stack traces readable. Function.prototype.toString carries that call across
  // into the page, where the helper does not exist -- so every serialised
  // function containing one throws \`ReferenceError: __name is not defined\`.
  //
  // This was NOT theoretical. \`relativeLuminance\` has an inner arrow, so the
  // entire contrast computation threw for every element it was asked to check.
  // The opacity check therefore never ran once across ten routes, and the audit
  // reported "opacity: 0" -- a code path that never executed, presented as a
  // clean measurement. Caught by \`--self-test\`, which is why that exists.
  const __name = (fn) => fn;
  // Named SPACE_SCALE, not SCALE: the helpers below are serialised with
  // Function.prototype.toString, which drops their closure. isOffScale refers
  // to SPACE_SCALE by name, so the in-page binding has to carry that name or
  // the scan dies with a ReferenceError. It did, first run.
  const SPACE_SCALE = ${JSON.stringify([...SPACE_SCALE])};
  const parseRgba = ${parseRgba.toString()};
  const compositeOver = ${compositeOver.toString()};
  const relativeLuminance = ${relativeLuminance.toString()};
  const contrastRatio = ${contrastRatio.toString()};
  const effectiveContrast = ${effectiveContrast.toString()};
  const requiredContrast = ${requiredContrast.toString()};
  const isOffScale = ${isOffScale.toString()};

  const out = { scanned: {}, findings: [] };
  const push = (kind, selector, detail) => out.findings.push({ kind, selector, detail });

  const sel = (el) => {
    if (el.id) return "#" + el.id;
    const raw = typeof el.className === "string" ? el.className : "";
    const cls = raw.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
    return el.tagName.toLowerCase() + (cls ? "." + cls : "");
  };

  const backdrop = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const bg = parseRgba(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? compositeOver(acc, bg) : bg;
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const root = parseRgba(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? compositeOver(acc, root) : root;
  };

  const effectiveOpacity = (el) => {
    let o = 1;
    let node = el;
    while (node && node !== document.documentElement) {
      const v = parseFloat(getComputedStyle(node).opacity);
      if (!Number.isNaN(v)) o *= v;
      node = node.parentElement;
    }
    return o;
  };

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };

  /* ---------------- OPACITY -> CONTRAST ---------------- */
  const textEls = [...document.querySelectorAll("body *")].filter(
    (el) => visible(el) && ownText(el).length > 0 && !el.closest("[aria-hidden='true']")
  );
  out.scanned.textElements = textEls.length;
  let dimmed = 0;
  for (const el of textEls) {
    const s = getComputedStyle(el);
    const o = effectiveOpacity(el);
    if (o >= 0.999) continue;
    dimmed++;
    if (el.closest("[disabled], [aria-disabled='true']")) continue;
    const fg = parseRgba(s.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const px = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const need = requiredContrast(px, bold);
    const r = effectiveContrast(fg, bg, o);
    if (r < need) {
      push(
        "opacity",
        sel(el),
        "opacity " + o.toFixed(2) + " composites " + s.color + " to " + r.toFixed(2) + ":1, needs " + need + ":1 (" + px + "px" + (bold ? " bold" : "") + ") - text: " + JSON.stringify(ownText(el).slice(0, 40))
      );
    }
  }
  out.scanned.dimmedTextElements = dimmed;

  /* ---------------- SPACING ---------------- */
  // Widened after the first pass reported zero: the original list covered
  // containers only, so the tab rails, the command bar and the route sidebar --
  // the chrome a user looks at on every single screen -- were never measured.
  const boxes = [...document.querySelectorAll(
    ".panel, .mini-panel, .route-view, .card, section, .table-wrap, .gov-fields, " +
    ".panel-tabs, [role='tablist'], [role='tabpanel'], header, nav, footer, .route-header, .mini-panel-title"
  )].filter(visible);
  out.scanned.spacingBoxes = boxes.length;
  for (const el of boxes) {
    const s = getComputedStyle(el);
    const props = ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "rowGap", "columnGap"];
    const bad = props.filter((p) => typeof s[p] === "string" && s[p].endsWith("px") && isOffScale(parseFloat(s[p])));
    if (bad.length) push("spacing", sel(el), bad.map((p) => p + "=" + s[p]).join(", ") + " (scale " + SPACE_SCALE.join("/") + ")");
  }

  /* ---------------- TABBING ---------------- */
  const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
  const focusables = [...document.querySelectorAll(FOCUSABLE)].filter(visible);
  out.scanned.focusables = focusables.length;
  for (const el of focusables) {
    const ti = el.getAttribute("tabindex");
    if (ti && parseInt(ti, 10) > 0) push("tabbing", sel(el), "positive tabindex=" + ti + " overrides document order");
  }

  const tabs = [...document.querySelectorAll("[role='tab']")];
  out.scanned.tabs = tabs.length;
  for (const t of tabs) {
    if (!t.hasAttribute("aria-selected")) push("tabbing", sel(t), "role=tab without aria-selected");
    const controls = t.getAttribute("aria-controls");
    if (!controls) { push("tabbing", sel(t), "role=tab without aria-controls"); continue; }
    const panel = document.getElementById(controls);
    if (!panel) { push("tabbing", sel(t), "aria-controls points at #" + controls + ", which does not exist"); continue; }
    if (panel.getAttribute("role") !== "tabpanel") push("tabbing", sel(t), "aria-controls target #" + controls + " is not role=tabpanel");
    // The panel is shared by every tab in the list, so it labels itself back to
    // the SELECTED tab rather than to each one. Check that the label names a
    // real tab, and that it names the one currently selected.
    const labelledBy = panel.getAttribute("aria-labelledby");
    const labelTab = labelledBy ? document.getElementById(labelledBy) : null;
    if (!labelTab || labelTab.getAttribute("role") !== "tab") {
      push("tabbing", sel(t), "tabpanel #" + controls + " is not labelled by any tab");
    } else if (t.getAttribute("aria-selected") === "true" && labelTab !== t) {
      push("tabbing", sel(t), "this tab is selected but the panel is labelled by #" + labelledBy);
    }
  }

  // WCAG 2.5.8 Target Size (Minimum), as the criterion is actually written --
  // which is NOT "every control is at least 24x24".
  //
  // Two wrong versions preceded this one, and both are worth recording because
  // each failed in the opposite direction:
  //
  //  1. Reading getBoundingClientRect() alone called .demo-banner-close a
  //     violation at 20x20. It is not: that button carries a 44x44 positioned
  //     ::after precisely so the hit area can grow without moving the glyph.
  //     A pseudo-element is hit-testable but has no border box, so geometry
  //     cannot see it. Acting on that would have "fixed" a correct control and
  //     removed a deliberate technique.
  //
  //  2. Hit-testing the four corners of a 24x24 box produced 169 findings,
  //     including every in-panel tab (21px tall, ~90px wide, 16px apart). Those
  //     pass under the SPACING exception: a 24px-diameter circle centred on each
  //     does not intersect its neighbour's. 169 false accusations is worse than
  //     no checker at all -- it buries the real ones.
  //
  // So: pass on size, else pass on effective hit area, else pass on spacing,
  // else report. Exceptions for inline text links and disabled controls.
  const centreOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };

  const hitCorners = (el) => {
    const c = centreOf(el);
    const d = 11; // corners of a 24x24 box, half a pixel of tolerance
    let hits = 0;
    for (const [x, y] of [[c.x - d, c.y - d], [c.x + d, c.y - d], [c.x - d, c.y + d], [c.x + d, c.y + d]]) {
      if (x < 0 || y < 0 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
      const at = document.elementFromPoint(x, y);
      if (at && (at === el || el.contains(at))) hits += 1;
    }
    return hits;
  };

  const targets = focusables.filter((el) => !el.closest("[disabled], [aria-disabled='true']"));
  const centres = targets.map(centreOf);
  out.scanned.targetsMeasured = targets.length;

  for (let i = 0; i < targets.length; i += 1) {
    const el = targets[i];
    // "Inline" exception: a link inside a sentence or list item.
    if (el.tagName === "A" && el.closest("p, li, .small-note, .muted-note")) continue;

    const c = centres[i];
    if (c.w >= 23.5 && c.h >= 23.5) continue;           // large enough outright
    if (hitCorners(el) === 4) continue;                  // hit area extended
    // "Spacing" exception: no other target's 24px circle intersects this one's.
    let crowded = false;
    for (let j = 0; j < targets.length && !crowded; j += 1) {
      if (j === i) continue;
      const o = centres[j];
      if (Math.hypot(c.x - o.x, c.y - o.y) < 24) crowded = true;
    }
    if (!crowded) continue;

    push(
      "tabbing",
      sel(el),
      "target " + Math.round(c.w) + "x" + Math.round(c.h) + ", hit area under 24x24, and another target sits within 24px (WCAG 2.5.8)"
    );
  }

  /* ---------------- MODEL OUTPUTS ---------------- */
  // Scoped to the ROUTE, not the panel.
  //
  // The first version of this check asked "does this panel contain a provenance
  // affordance?" and produced twelve findings against five panels. All twelve
  // were wrong. Provenance in this product is stated ONCE per route, in the
  // governance banner, and the per-panel source badges were deliberately removed
  // as repetition. Acting on that output would have re-added exactly what a
  // previous audit took out.
  //
  // So the question is the one CLAUDE.md actually asks: if this route shows
  // model numbers, does it state source, freshness, confidence, assumptions,
  // validation state, and fixture/live mode -- with VALUES, not just labels.
  const panels = [...document.querySelectorAll("section[id][aria-labelledby], .mini-panel[id]")].filter(visible);
  out.scanned.panels = panels.length;
  const numericPanels = panels.filter((p) => ((p.innerText || "").match(/\d/g) || []).length >= 5);
  out.scanned.numericPanels = numericPanels.length;

  if (numericPanels.length > 0) {
    const fields = new Map();
    for (const f of document.querySelectorAll(".gov-field")) {
      const label = (f.querySelector(".gov-field-label")?.textContent || "").trim().toLowerCase();
      const value = (f.querySelector(".gov-field-value")?.textContent || "").trim();
      if (label) fields.set(label, value);
    }
    out.scanned.governanceFields = fields.size;

    const REQUIRED = ["source", "freshness", "confidence", "validation"];
    for (const want of REQUIRED) {
      const key = [...fields.keys()].find((k) => k.includes(want));
      if (!key) {
        push("model-output", "route", "shows model numbers in " + numericPanels.length + " panels but never states " + want);
      } else if (!fields.get(key)) {
        push("model-output", "route", "states a '" + key + "' label with no value");
      }
    }

    // Assumptions: CLAUDE.md requires them shown, not merely available.
    if (!document.querySelector(".gov-assume, .gov-assume-list")) {
      push("model-output", "route", "shows model numbers but exposes no assumptions block");
    }

    // Fixture / live / unavailable mode has to be legible on the page itself,
    // not inferred from the freshness value alone.
    //
    // Tokenised rather than matched with a word-boundary regex. The regex
    // version accused /dashboard of never stating its mode, on a page whose
    // visible text contains the word "fixture": includes() said true while the
    // word-boundary test said false, because the pattern crosses a template
    // literal, a serialised function and an eval, and one of those layers eats a
    // backslash. A false accusation from a checker is worse than no checker --
    // it sends someone to add a disclosure that is already on the page.
    //
    // Note the two hazards this very comment had to be rewritten to avoid: a
    // backtick would have closed the template literal it lives in (esbuild:
    // "Expected ; but found body"), and a backslash-b would have compiled to a
    // literal backspace byte -- the same defect this audit found in a regex once
    // before. Splitting on non-letters needs neither.
    const words = new Set((document.body.innerText || "").toLowerCase().split(/[^a-z]+/));
    const MODES = ["fixture", "demo", "live", "unavailable"];
    if (!MODES.some((m) => words.has(m))) {
      push("model-output", "route", "shows model numbers without stating fixture / live / unavailable mode");
    }
  }

  return out;
})()`;
