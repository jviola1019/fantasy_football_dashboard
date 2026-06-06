import type { RAEEnvelope } from "@/lib/governance";
import { ModeBanner } from "./ModeBanner";
import { SourceFreshnessBadge } from "./SourceFreshnessBadge";
import { AssumptionsDrawer } from "./AssumptionsDrawer";

/**
 * Reusable, self-contained governance summary: mode + source/freshness/
 * confidence/validation + an assumptions/data-gaps disclosure. Drop it anywhere a
 * surface needs to declare exactly what is driving it and whether it can be
 * trusted.
 */
export function GovernancePanel({ envelope }: { envelope: RAEEnvelope }) {
  return (
    <div className="gov-panel">
      <div className="gov-panel-head">
        <ModeBanner mode={envelope.mode} freshness={envelope.sourceState.freshness} />
        <SourceFreshnessBadge sourceState={envelope.sourceState} />
      </div>
      {envelope.sourceState.failure ? (
        <p className="gov-panel-failure">Adapter note: {envelope.sourceState.failure}</p>
      ) : null}
      <AssumptionsDrawer sourceState={envelope.sourceState} />
    </div>
  );
}
