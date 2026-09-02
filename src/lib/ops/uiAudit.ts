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

/**
 * The type scale declared in `globals.css:106-113`, in the same order.
 *
 * Mirrored here for the same reason `SPACE_SCALE` is: the audit has to know what
 * the design system claims before it can say anything about what the page does.
 * `src/app/typeScale.test.ts` already proves the CSS side is well-formed and
 * strictly increasing; this array exists so the *runtime* side can be bucketed
 * against it.
 */
export const TYPE_SCALE = [9, 11, 13, 16, 20, 26, 34, 44] as const;

/**
 * Share of rendered text allowed to sit on the bottom two rungs (9px and 11px).
 *
 * Set from measurement, not taste — see `reports/2026-08-28/`. The CSS side is
 * 77% bottom-heavy (130 of 169 declarations), but CSS declarations and rendered
 * elements are different populations: most of the DOM inherits 13px body copy
 * and never declares a size at all. The gate is on what a reader actually sees.
 */
export const BOTTOM_HEAVY_LIMIT = 0.6;

/**
 * Smallest rendered text the design system permits, in CSS pixels.
 *
 * `--text-micro` is 9px and is licensed for dense grid labels only
 * (`globals.css:91-102`). Anything that lands BELOW it is off the scale
 * entirely, and the case that motivates this check is invisible to every other
 * gate in the repo: `fontSize="8"` inside a 560-unit viewBox
 * (`MarketIntelligence.tsx:422`) renders at roughly 5-6 CSS px once the viewBox
 * scales it down. `typeScale.test.ts` cannot see it — it bans `font-size: Npx`
 * in CSS and numeric `fontSize:` in style objects, not SVG presentation
 * attributes, which are the one place a raw number is legitimate syntax.
 *
 * `NexusSimulator.tsx:236-247` already hit this and fixed it by moving the
 * labels out of the SVG into HTML. Nothing stopped it coming back.
 */
export const MIN_RENDERED_PX = 9;

export interface UiFinding {
  kind: "spacing" | "tabbing" | "opacity" | "model-output" | "type-scale" | "cta";
  detail: string;
  selector: string;
  route?: string;
}

/** The scale step a rendered size belongs to, or null if it is off-scale. */
export function nearestScaleStep(px: number): number | null {
  if (!Number.isFinite(px) || px <= 0) return null;
  let best: number | null = null;
  let bestGap = Infinity;
  for (const step of TYPE_SCALE) {
    const gap = Math.abs(step - px);
    if (gap < bestGap) {
      bestGap = gap;
      best = step;
    }
  }
  // Sub-pixel tolerance only. Browsers round (a computed 13.008px is still
  // --text-sm) but they do not round by whole pixels, so the budget is 0.75.
  //
  // A first version allowed 1.5px and was wrong at the top of the ladder, where
  // the rungs are far apart: 14.9px is 1.1px from the 16px rung, so a loose
  // tolerance swallowed it and called an off-scale size on-scale. The gaps grow
  // from 2px at the bottom to 10px at the top, so a fixed generous tolerance
  // means the check quietly stops working exactly where headings live.
  return bestGap <= 0.75 ? best : null;
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
 * INFINITE animations are excluded deliberately: the live-status dot pulses
 * forever, so awaiting it would hang. Resolves `false` on timeout rather than
 * throwing, so the caller can say the measurement is unsettled instead of
 * silently reporting whatever it happened to catch.
 *
 * NOTE (2026-09-01): `card-fade-in`, `label-reveal` and the live-badge blink
 * named above are GONE — removed with the other non-data-encoded motion. The
 * paragraphs stay because they are the evidence for why this helper is shaped
 * the way it is, and because the shape still earns its keep: Radix's dropdown
 * and sheet transitions, the skeleton pulse and the live dot all still animate,
 * and the next entrance animation somebody adds will hit exactly this. Read
 * them as a record of what happened, not as a description of the stylesheet.
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
  // Consecutive quiet frames required before declaring the page settled.
  //
  // One frame was not enough. A first version resolved after a single empty
  // check and still caught a .section-label at "opacity 0.00" -- the very first
  // frame of label-reveal -- on /trades under full-suite load. That route does
  // a live FantasyCalc fetch, so its content lands late and its entrance
  // animations register after a wait that has already finished. The scan then
  // reported a 1.00:1 contrast failure against text that is simply not painted
  // yet: a false accusation, and an intermittent one, which is worse than a
  // consistent bug because it teaches people to re-run rather than look.
  const QUIET_FRAMES = 3;
  const settle = () => {
    if (Date.now() - start > HARD_LIMIT_MS) { resolve(false); return; }
    const running = pending();
    if (running.length === 0) {
      let quiet = 0;
      const check = () => {
        if (Date.now() - start > HARD_LIMIT_MS) { resolve(false); return; }
        if (pending().length > 0) { settle(); return; }
        quiet += 1;
        if (quiet >= QUIET_FRAMES) { resolve(true); return; }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
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
  // Same closure-dropping rule as SPACE_SCALE above: nearestScaleStep refers to
  // TYPE_SCALE by name, so the in-page binding must carry that exact name.
  const TYPE_SCALE = ${JSON.stringify([...TYPE_SCALE])};
  const BOTTOM_HEAVY_LIMIT = ${BOTTOM_HEAVY_LIMIT};
  const MIN_RENDERED_PX = ${MIN_RENDERED_PX};
  const nearestScaleStep = ${nearestScaleStep.toString()};
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
  // An element that is still animating has no settled style to judge.
  //
  // WAIT_FOR_ANIMATIONS settles the page before the scan, but the two are
  // separate page.evaluate calls with an IPC round trip between them, and on a
  // route whose content arrives late -- /trades does a live FantasyCalc fetch --
  // an entrance animation can register in that gap. The scan then reads frame
  // zero of label-reveal, sees opacity 0.00, and reports a 1.00:1 contrast
  // failure against text that simply is not painted yet.
  //
  // Checked per element rather than globally so one late-mounting label does not
  // suppress the whole route's findings. Counted, so the number is visible
  // rather than silently swallowed.
  const isAnimating = (el) => {
    if (typeof el.getAnimations !== "function") return false;
    return el.getAnimations({ subtree: false }).some((a) => a.playState === "running");
  };

  let dimmed = 0;
  let unsettled = 0;
  for (const el of textEls) {
    const s = getComputedStyle(el);
    const o = effectiveOpacity(el);
    if (o >= 0.999) continue;
    dimmed++;
    if (isAnimating(el)) { unsettled++; continue; }
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
  // Non-zero here means the page was still moving when it was measured. A
  // persistently high count would mean the settle logic is losing the race,
  // not that the page is clean.
  out.scanned.unsettledTextElements = unsettled;

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

  /* ---------------- TYPE SCALE ---------------- */
  // Two questions, both about what a reader actually sees rather than what the
  // stylesheet declares. typeScale.test.ts already proves the LADDER is
  // well-formed; nothing proves the ladder is USED.
  //
  // 1. Is anything rendering below the floor? The motivating case is SVG text:
  //    a font-size presentation attribute is in USER UNITS, and a viewBox scales
  //    it. fontSize="8" in a 560-wide viewBox laid out at ~360 CSS px renders
  //    around 5px. getComputedStyle reports 8; the reader sees 5.
  // 2. Is the hierarchy collapsed? A scale whose bottom two rungs carry
  //    everything is a scale in name only.
  const renderedFontPx = (el) => {
    const raw = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(raw)) return null;
    // SVG user units -> CSS px. The determinant's square root is the geometric
    // mean of the x and y scales, which is the right single number for text
    // that may be non-uniformly scaled.
    if (el.ownerSVGElement && typeof el.getScreenCTM === "function") {
      const m = el.getScreenCTM();
      if (m) {
        const det = Math.abs(m.a * m.d - m.b * m.c);
        const scale = det > 0 ? Math.sqrt(det) : 1;
        return raw * scale;
      }
    }
    return raw;
  };

  // Deduped by ELEMENT. An <svg><text> is a descendant of body, so it matches
  // "body *" AND the explicit SVG query below -- a first version counted every
  // SVG label twice, which inflated the histogram, the bottom-heavy share and
  // the finding count all at once. The explicit query still earns its place:
  // tspan is not reliably picked up by the own-text filter.
  const seenSized = new Set();
  const sized = [];
  const addSized = (el) => {
    if (seenSized.has(el)) return;
    seenSized.add(el);
    const px = renderedFontPx(el);
    if (px !== null) sized.push({ el: el, px: px });
  };
  for (const el of textEls) addSized(el);
  for (const el of document.querySelectorAll("svg text, svg tspan")) {
    if (visible(el) && ownText(el).length > 0) addSized(el);
  }
  out.scanned.sizedTextElements = sized.length;

  const histogram = {};
  let bottomHeavy = 0;
  for (const s of sized) {
    if (s.px < MIN_RENDERED_PX - 0.5) {
      push(
        "type-scale",
        sel(s.el),
        "renders at " + s.px.toFixed(1) + "px, below the " + MIN_RENDERED_PX + "px floor" +
          (s.el.ownerSVGElement ? " (SVG user units scaled by the viewBox)" : "") +
          " - text: " + JSON.stringify(ownText(s.el).slice(0, 32))
      );
      continue;
    }
    const step = nearestScaleStep(s.px);
    const key = step === null ? "off-scale" : String(step);
    histogram[key] = (histogram[key] || 0) + 1;
    if (step === TYPE_SCALE[0] || step === TYPE_SCALE[1]) bottomHeavy++;
  }
  // Only NUMBERS go in out.scanned: the multi-tab merger in
  // e2e/27-ui-audit.spec.ts folds passes together with Math.max, and an object
  // there becomes NaN. The histogram is diagnostic, so it rides in the finding
  // detail where it is read by a human, not maxed by a machine.
  out.scanned.bottomHeavyShare = sized.length > 0 ? bottomHeavy / sized.length : 0;
  out.scanned.offScaleTextElements = histogram["off-scale"] || 0;

  // Route-scoped, like the governance check: "this page's hierarchy is
  // collapsed" is a statement about the page, not about any one element.
  //
  // The 40-element floor is a claim about what the check can meaningfully
  // measure, not a number chosen to make a route pass. Below roughly forty
  // sized elements a page does not have a hierarchy to judge -- it has a
  // fragment: an empty state, an error state, or a partial render. Ranking is a
  // property of a populated screen.
  //
  // It also removes a real flake. /trades fetches FantasyCalc over the live
  // network during SSR; under full-suite load that degrades, the page drops to
  // a fraction of its content, and the surviving elements are proportionally
  // more small text. The route passed alone and failed in the suite -- the
  // check was reading a degraded render and calling it a design defect.
  if (sized.length >= 40 && out.scanned.bottomHeavyShare > BOTTOM_HEAVY_LIMIT) {
    // The detail is DELIBERATELY constant. Callers union findings across every
    // tab state and dedupe on kind|selector|detail, so a message carrying the
    // measured share or the histogram produces a different string per tab and
    // the same single problem is counted four or six times. The measurement
    // still ships -- as out.scanned.bottomHeavyShare, which the merger maxes.
    push(
      "type-scale",
      "route",
      "hierarchy collapsed: more than " + Math.round(BOTTOM_HEAVY_LIMIT * 100) +
        "% of rendered text sits on the bottom two rungs (" + TYPE_SCALE[0] + "px/" + TYPE_SCALE[1] +
        "px) - see scanned.bottomHeavyShare for the measured value"
    );
  }

  /* ---------------- PRIMARY CTA ---------------- */
  // AT MOST one, never "exactly one". RouteHeader.tsx:34-42 argues, correctly,
  // that inventing a button for a route with no distinct action is fabricating
  // an affordance -- the interface equivalent of fabricating a number. Six of
  // seven analysis routes deliberately have none, and this gate must not push
  // anyone to add them. What it prevents is the opposite failure: amber
  // spreading until nothing is primary.
  //
  // "Primary" is defined the way e2e/03-a11y.spec.ts already defines it -- a
  // solid --amber background -- so the two gates cannot disagree about what a
  // CTA is.
  const AMBER = parseRgba("rgb(215, 168, 87)");
  // Off-screen-until-focused affordances are not CTAs. The skip link is amber
  // and is the FIRST tab stop on every route by design (e2e/03-a11y.spec.ts
  // asserts exactly that), so a naive count reported "2 competing CTAs" on all
  // ten routes -- an accusation aimed at the accessibility feature. Excluded by
  // geometry rather than by class name, so the rule survives a rename and also
  // covers any other skip-target added later.
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  };
  const ctas = [...document.querySelectorAll("a, button, [role='button']")].filter((el) => {
    if (!visible(el) || !onScreen(el)) return false;
    const bg = parseRgba(getComputedStyle(el).backgroundColor);
    if (!bg || bg.a < 0.9) return false;
    return Math.abs(bg.r - AMBER.r) < 8 && Math.abs(bg.g - AMBER.g) < 8 && Math.abs(bg.b - AMBER.b) < 8;
  });
  out.scanned.primaryCtas = ctas.length;
  if (ctas.length > 1) {
    push(
      "cta",
      "route",
      ctas.length + " primary (amber) CTAs compete on one route: " + ctas.map(sel).join(", ")
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
