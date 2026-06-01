/**
 * Deterministic, seedable PRNG shared by the simulators. Kept in its own module
 * so `simulation.ts` and `seasonSim.ts` can both use it without an import cycle.
 */

/** mulberry32 — a fast, well-distributed 32-bit seedable generator in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
