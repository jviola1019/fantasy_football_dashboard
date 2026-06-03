"use client";

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
import { systems } from "../systems";

interface Props {
  active: string;
  onSelect: (system: string) => void;
}

/**
 * Left navigation rail. Built on the shadcn <Sidebar collapsible="icon">
 * block: every one of the nine top-level systems gets a tooltip-labelled
 * icon, the active system is highlighted, and selecting one scrolls its panel
 * into view (handler supplied by RaeApp). Collapses to an icon rail and turns
 * into a drawer on mobile — all from the shadcn block, no bespoke CSS.
 */
export function AppSidebar({ active, onSelect }: Props) {
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1.5 py-1">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-sidebar-border bg-sidebar-accent font-bold tracking-[0.14em] text-rae-blue">
            R
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-extrabold tracking-[0.14em] text-foreground">RAE</span>
            <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Reputation Arbitrage Engine
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {systems.map((system, index) => (
                <SidebarMenuItem key={system}>
                  <SidebarMenuButton
                    isActive={active === system}
                    tooltip={`${index + 1}. ${system}`}
                    onClick={() => onSelect(system)}
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded text-[11px] font-bold tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span>{system}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <span className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground group-data-[collapsible=icon]:hidden">
          9 systems · all operational
        </span>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
