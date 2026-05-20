"use client";

import { Stars, Environment, Lightformer } from "@react-three/drei";

/**
 * Canonical scene backdrop: a starfield + soft fog that gives the scene the
 * sense of inset depth the blueprint screenshot has, plus a self-contained
 * image-based-lighting environment.
 *
 * The `<Environment>` renders three `Lightformer` panels into a cube texture
 * (no external HDR fetch — fully Vercel-safe and offline-safe). It provides
 * real reflections on the metallic node/ribbon/surface materials and a cool
 * back-bias that reinforces the StudioLighting back-light.
 */
export function Atmosphere({
  fogNear = 8,
  fogFar = 24,
  starCount = 1800,
  fogColor = "#070a0d"
}: {
  fogNear?: number;
  fogFar?: number;
  starCount?: number;
  fogColor?: string;
} = {}) {
  return (
    <>
      <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
      <color attach="background" args={[fogColor]} />
      <Stars
        radius={80}
        depth={32}
        count={starCount}
        factor={5}
        saturation={0}
        fade
        speed={0.35}
      />
      <Environment resolution={64} frames={1}>
        {/* Cyan back panel — the dominant reflection + IBL back-bias. */}
        <Lightformer
          intensity={2.6}
          color="#bfe6ff"
          position={[0, 1, -6]}
          scale={[10, 6, 1]}
        />
        {/* Magenta side rim — neon edge highlight on glossy materials. */}
        <Lightformer
          intensity={1.3}
          color="#f0abfc"
          position={[-5, 2, -2]}
          scale={[4, 8, 1]}
        />
        {/* Cool key fill from the front-right. */}
        <Lightformer
          intensity={0.85}
          color="#9ad0ff"
          position={[5, 4, 3]}
          scale={[6, 4, 1]}
        />
      </Environment>
    </>
  );
}
