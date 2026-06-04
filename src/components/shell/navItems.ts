/**
 * Canonical top-level route navigation for the multi-route app shell. Shared by
 * the desktop sidebar and the mobile bottom nav so they never drift. `primary`
 * marks the items shown in the compact mobile bottom bar.
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  /** Short label for the mobile bottom nav. */
  short: string;
  /** Shown in the mobile bottom bar (space-limited). */
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", short: "Home", primary: true },
  { key: "players", label: "Players", href: "/players", short: "Players", primary: true },
  { key: "analytics", label: "Analytics", href: "/analytics", short: "Analytics", primary: true },
  { key: "draft", label: "Draft", href: "/draft", short: "Draft", primary: true },
  { key: "waivers", label: "Waivers", href: "/waivers", short: "Waivers" },
  { key: "trades", label: "Trades", href: "/trades", short: "Trades", primary: true },
  { key: "league", label: "League", href: "/settings/leagues", short: "League" },
  { key: "settings", label: "Settings", href: "/settings/account", short: "Settings" }
];

/** The route whose panel(s) match a given key (for active-state matching). */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
