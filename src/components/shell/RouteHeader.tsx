"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navItems";

interface RoutePrimaryAction {
  /** Active voice — what happens when you use it. */
  label: string;
  href: string;
  /**
   * Why this action is being suggested. A recommendation with no stated basis
   * is what CLAUDE.md's governance rules forbid, so an action that cannot say
   * why it is here does not get to be here.
   */
  basis: string;
}

/**
 * What each route is for, in one sentence, from the reader's side of the screen.
 * Every in-app route had a `sr-only` <h1> and nothing else naming it, so a
 * sighted user landed in a stack of chrome with no page identity at all.
 */
const ROUTE_PURPOSE: Record<string, string> = {
  dashboard: "Your league at a glance, and the moves worth making next.",
  players: "Every player in the league pool, with the value, usage and hype behind each one.",
  analytics: "Market structure, season outcomes and team signals — each with its assumptions attached.",
  draft: "Board, tiers and roster construction for the picks you are about to make.",
  waivers: "Who is worth a claim this week, and who the rest of the league is already chasing.",
  trades: "Price a trade against real market values before you send it.",
  reports: "A printable record of what the model said, what it used, and how sure it was."
};

/**
 * Per-route primary action, in LIVE mode.
 *
 * Deliberately sparse. Most of these routes are analytical surfaces whose
 * content IS the thing you came for, and a CTA that scrolls the page you are
 * already on is noise. Inventing a button for a route with no distinct action
 * would be fabricating an affordance — the interface equivalent of fabricating
 * a number — so routes without one show no action rather than a decorative one.
 */
const ROUTE_ACTION: Record<string, RoutePrimaryAction | undefined> = {
  draft: {
    label: "Open mock draft",
    href: "/mock-draft",
    basis: "Rehearse the board against these tiers before it counts."
  }
};

/** Routes that own their own visible <h1> (settings) are excluded. */
const HEADED_ROUTES = new Set(Object.keys(ROUTE_PURPOSE));

function routeKeyFor(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  return HEADED_ROUTES.has(seg) ? seg : null;
}

/**
 * The visible top of every in-app panel route.
 *
 * WHY THIS EXISTS (design audit 2026-08-22, findings D-6 / D-8, UX questions 1
 * and 2). The loudest object on `/dashboard` used to be a SOLID AMBER,
 * NON-INTERACTIVE season chip, while the only <h1> was screen-reader-only.
 * Amber — the product's designated action colour — was being spent on a label,
 * and the page had no title at all. This header inverts that back:
 *
 *   26px route title   the only `--text-xl` on the page, so "what is this?" is
 *                      answered by rank rather than by reading
 *   13px purpose       one sentence naming the route's job
 *   amber action       the single primary CTA, and now the only solid-amber
 *                      interactive object in the shell
 *
 * In FIXTURE mode the action is the same on every route, because in demo mode
 * it genuinely is the same: connect a real league. CLAUDE.md puts onboarding
 * first, and nothing else a demo user does here is worth more than that.
 */
export function RouteHeader({ mode }: { mode: "live" | "fixture" | "unavailable" }) {
  const pathname = usePathname();
  const key = routeKeyFor(pathname ?? "");
  if (!key) return null;

  const index = NAV_ITEMS.findIndex((n) => n.key === key);
  const title = index === -1 ? key : NAV_ITEMS[index].label;
  const action: RoutePrimaryAction | undefined =
    mode === "fixture"
      ? {
          label: "Connect your league",
          href: "/settings/leagues",
          basis: "You are looking at demo data. Connect a league to run this on your team."
        }
      : ROUTE_ACTION[key];

  return (
    <header className="route-header">
      <div className="route-header-main">
        <h1 className="route-header-title">
          {index === -1 ? null : (
            <span className="route-header-num" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
          {title}
        </h1>
        <p className="route-header-purpose">{ROUTE_PURPOSE[key]}</p>
      </div>
      {action ? (
        <div className="route-header-action-wrap">
          <Link href={action.href} className="route-header-action">
            {action.label}
            <span aria-hidden="true"> →</span>
          </Link>
          <p className="route-header-basis">{action.basis}</p>
        </div>
      ) : null}
    </header>
  );
}
