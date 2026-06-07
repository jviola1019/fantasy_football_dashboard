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
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-background/95 backdrop-blur-xl md:hidden"
    >
      {items.map((item, i) => {
        const active = isActiveHref(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] transition-colors",
              active ? "text-rae-blue" : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid h-5 min-w-5 place-items-center rounded text-[11px] font-bold tabular-nums",
                active ? "bg-rae-blue/15 text-rae-blue" : "text-muted-foreground"
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
