"use client";

import { Suspense, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";

export interface Canvas3DProps {
  children: ReactNode;
  height?: number | string;
  ariaLabel: string;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Canvas3D({ children, height = 240, ariaLabel, className, style }: Canvas3DProps) {
  const reduced = useReducedMotion();
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ position: "relative", width: "100%", height, ...style }}
    >
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 6], fov: 50 }}
        frameloop={reduced ? "never" : "demand"}
        style={{ display: "block" }}
      >
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
    </div>
  );
}
