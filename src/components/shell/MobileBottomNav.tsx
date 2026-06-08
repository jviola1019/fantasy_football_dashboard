"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, isActiveHref } from "./navItems";

/**
 * Fixed bottom navigation for mobile. Shows the `primary` routes only (space is
 * limited) as real `<Link>`s with an active state matched on the pathname.
 * Hidden at `md` and up, where the sidebar takes over. A spacer in the shell
 * keeps content clear of the fixed bar.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.primary);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {items.map((item, i) => {
        const active = isActiveHref(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 px-1 pb-2 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.04em] transition-colors",
              active ? "text-rae-blue" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {/* Active indicator rail. A <div> (not a span[aria-hidden]) so the
                bottom-nav badge selector in e2e/16-topbar-nav stays exact. */}
            {active && (
              <div
                aria-hidden="true"
                className="absolute inset-x-3 top-0 h-[3px] rounded-full bg-rae-blue shadow-[0_0_10px_rgba(90,159,196,0.6)]"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "grid h-6 min-w-6 place-items-center rounded-md text-[11px] font-bold tabular-nums transition-colors",
                active
                  ? "bg-rae-blue text-background shadow-[0_2px_8px_rgba(90,159,196,0.45)]"
                  : "text-muted-foreground"
              )}
            >
              {/* Number the VISIBLE bottom-nav items sequentially (1..N) so there's
                  no gap when a non-primary route (e.g. Waivers) is skipped. */}
              {i + 1}
            </span>
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
