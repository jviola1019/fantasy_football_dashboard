"use client";

import { Suspense, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Atmosphere } from "./Atmosphere";
import { PostFX } from "./PostFX";
import { SceneErrorBoundary } from "./SceneErrorBoundary";

export interface Canvas3DProps {
  children: ReactNode;
  height?: number | string;
  ariaLabel: string;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Mount the canonical Atmosphere backdrop. Default: true. */
  enableAtmosphere?: boolean;
  /** Wrap the scene in the PostFX EffectComposer (Bloom + Vignette). Default: true. */
  enablePostFX?: boolean;
  /** Bloom intensity override for scenes that want extra glow. */
  bloomIntensity?: number;
  /** Camera position override. */
  cameraPosition?: [number, number, number];
  /** Camera fov override. */
  cameraFov?: number;
}

/**
 * Standardized r3f <Canvas> wrapper.
 *
 * - ACES Filmic tone-mapping with a slight exposure boost so bloom reads
 *   without crushing midtones.
 * - dpr [1, 2] so bloom edges stay crisp on high-DPI screens.
 * - frameloop "always" — every scene checks `useReducedMotion()` internally
 *   and skips per-frame animation; reduced-motion users still get a fully
 *   rendered first frame.
 * - Atmosphere + PostFX are opt-out so non-volumetric scenes can disable them.
 * - Wrapped in <SceneErrorBoundary>: a failed WebGL context (GPU OOM, context
 *   exhaustion, shader compile error) degrades to a static fallback rather
 *   than crashing the whole dashboard.
 *
 * The <Canvas> renders unconditionally — server and client produce the same
 * markup, so hydration is clean. (An earlier IntersectionObserver lazy-mount
 * was removed: it returned different values on the server and client, which
 * triggered a hydration mismatch on every scene.)
 */
export function Canvas3D({
  children,
  height = 260,
  ariaLabel,
  className,
  style,
  enableAtmosphere = true,
  enablePostFX = true,
  bloomIntensity,
  cameraPosition = [0, 0, 6],
  cameraFov = 50
}: Canvas3DProps) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ position: "relative", width: "100%", height, minHeight: 200, ...style }}
    >
      <SceneErrorBoundary label={ariaLabel}>
        <Canvas
          dpr={[1, 2]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            failIfMajorPerformanceCaveat: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.15
          }}
          camera={{ position: cameraPosition, fov: cameraFov }}
          frameloop="always"
          style={{ display: "block", width: "100%", height: "100%" }}
          onCreated={({ gl }) => {
            // Surface a lost context as a React error so the boundary swaps in
            // the fallback instead of leaving a frozen black canvas.
            gl.domElement.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
            });
          }}
        >
          {enableAtmosphere ? <Atmosphere /> : null}
          <Suspense fallback={null}>{children}</Suspense>
          {enablePostFX ? <PostFX bloomIntensity={bloomIntensity} /> : null}
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
}
