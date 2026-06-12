"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from "@/components/ui/sidebar";
import { NAV_ITEMS, isActiveHref } from "./navItems";

/**
 * Left navigation rail for the multi-route app. Built on the shadcn
 * `<Sidebar collapsible="icon">` block: each top-level route gets a numbered
 * marker + label, the active route (matched on the pathname) is highlighted,
 * and selecting one is a real client-side `<Link>` navigation. Collapses to an
 * icon rail and becomes a drawer on mobile — all from the shadcn block.
 */
export function RouteSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2 px-1.5 py-1">
          {/* The RAE emblem — identical mark to src/app/icon.svg (favicon), so the
              brand reads as one mark everywhere: ascending bars + amber edge accent. */}
          <svg
            viewBox="0 0 32 32"
            className="size-8 shrink-0"
            role="img"
            aria-label="RAE emblem"
          >
            <rect width="32" height="32" rx="7" fill="#0b1120" />
            <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="6" fill="none" stroke="#5a9fc4" strokeOpacity="0.28" />
            <rect x="7" y="18" width="4.2" height="7" rx="1.2" fill="#5a9fc4" />
            <rect x="13.9" y="13" width="4.2" height="12" rx="1.2" fill="#5a9fc4" />
            <rect x="20.8" y="8" width="4.2" height="17" rx="1.2" fill="#5a9fc4" />
            <circle cx="22.9" cy="6" r="2.1" fill="#d7a857" />
          </svg>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-extrabold tracking-[0.14em] text-foreground">RAE</span>
            <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Reputation Arbitrage Engine
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item, index) => {
                const active = isActiveHref(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={`${index + 1}. ${item.label}`}>
                      <Link href={item.href} aria-current={active ? "page" : undefined}>
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded text-[11px] font-semibold tabular-nums transition-colors",
                            // Quiet, instrument-like: the active route reads via
                            // a low-contrast tint + accent text, not a bright
                            // glowing chip. Selection emphasis comes from the
                            // row's own active background + the accent text.
                            active
                              ? "bg-rae-blue/15 text-rae-blue"
                              : "text-muted-foreground/70"
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className={cn(active && "font-semibold text-foreground")}>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <span className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground group-data-[collapsible=icon]:hidden">
          {NAV_ITEMS.length} routes
        </span>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
