"use client";

import { Suspense, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";

export interface Canvas3DProps {
  children: ReactNode;
  height?: number | string;
  ariaLabel: string;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Canvas3D({ children, height = 240, ariaLabel, className, style }: Canvas3DProps) {
  // frameloop="always" — every scene calls useReducedMotion() internally and
  // skips per-frame animation, so reduced-motion users get a static rendered
  // image. The previous "demand" mode left the canvas blank because nothing
  // requested the initial frame.
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ position: "relative", width: "100%", height, minHeight: 120, ...style }}
    >
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 6], fov: 50 }}
        frameloop="always"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
    </div>
  );
}
