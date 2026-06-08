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
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-sidebar-border bg-sidebar-accent font-bold tracking-[0.14em] text-rae-blue">
            R
          </div>
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
                            "grid size-5 shrink-0 place-items-center rounded text-[11px] font-bold tabular-nums transition-colors",
                            active
                              ? "bg-rae-blue text-background shadow-[0_1px_6px_rgba(90,159,196,0.45)]"
                              : "text-muted-foreground"
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
