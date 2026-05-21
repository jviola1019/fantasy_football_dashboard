"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
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
 *   exhaustion, shader compile error) degrades to a static placeholder rather
 *   than crashing the whole dashboard.
 *
 * Lazy mounting
 * -------------
 * Each <Canvas> holds one live WebGL context. Browsers cap concurrent
 * contexts — and the cap is much lower on mobile GPUs — so a dashboard with
 * six always-on scenes can exhaust the budget and degrade later scenes to the
 * fallback. To stay within budget the <Canvas> is only mounted once its
 * wrapper scrolls near the viewport (IntersectionObserver, generous
 * rootMargin) and is unmounted again once it scrolls well clear, freeing the
 * context for whichever scenes the user is actually looking at. Before mount —
 * and on browsers without IntersectionObserver — a sensible static placeholder
 * fills the wrapper so the region is never blank.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  // `active` drives whether the live <Canvas> is mounted. When
  // IntersectionObserver is available it starts false — SSR and the first
  // client paint render the lightweight placeholder, and the observer flips it
  // on as the wrapper nears the viewport. On platforms without
  // IntersectionObserver (or non-DOM test envs) it starts true so the scene is
  // never permanently stuck on the placeholder.
  const [active, setActive] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    const el = wrapRef.current;
    // No element, or no IntersectionObserver support: nothing to observe —
    // `active` already reflects the correct mount decision.
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setActive(entry.isIntersecting);
        }
      },
      {
        // Generous margin: mount scenes a full viewport before they scroll in
        // (and keep them mounted a full viewport after they leave) so the
        // canvas is always painted by the time it is actually visible.
        rootMargin: "100% 0px 100% 0px",
        threshold: 0
      }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ position: "relative", width: "100%", height, minHeight: 200, ...style }}
    >
      <SceneErrorBoundary label={ariaLabel}>
        {active ? (
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
        ) : (
          <ScenePlaceholder />
        )}
      </SceneErrorBoundary>
    </div>
  );
}

/**
 * Static stand-in shown before a scene's <Canvas> mounts (or after it scrolls
 * far off-screen). Visually distinct from the error `.scene-fallback`: this is
 * a calm "loading" state, not a failure state.
 */
function ScenePlaceholder() {
  return (
    <div className="scene-placeholder" aria-hidden>
      <span className="scene-placeholder-mark">◦ ◦ ◦</span>
    </div>
  );
}
