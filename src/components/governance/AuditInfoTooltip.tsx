"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A small accessible "ⓘ" affordance that reveals an audit/lineage note on hover
 * or focus. Used to attach a metric's provenance to its label without cluttering
 * the panel. Keyboard + screen-reader accessible via the Radix tooltip.
 */
export function AuditInfoTooltip({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About: ${label}`}
            className="audit-info"
          >
            ⓘ
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-left text-xs leading-relaxed">
          {children ?? label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
