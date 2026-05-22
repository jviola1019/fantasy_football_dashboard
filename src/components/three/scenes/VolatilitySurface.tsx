"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { SimulationResult } from "@/lib/simulation";
import { StudioLighting } from "../lighting/StudioLighting";
// `surfaceMaterial` is registered with R3F via a module-level `extend()` side
// effect. The `SurfaceMaterial` symbol below is referenced only in a type
// position, so the bundler (SWC/Turbopack) would otherwise elide the whole
// module and the `<surfaceMaterial>` intrinsic would be unknown to R3F. The
// bare import keeps the side effect alive.
import "../shaders/surfaceMaterial";
import type { SurfaceMaterial } from "../shaders/surfaceMaterial";

interface Props {
  sim: SimulationResult;
}

const GRID = 64;

/**
 * Monte Carlo volatility surface. Height = a smooth + bumpy function of
 * playoff probability and catastrophic risk. Custom shader gradient runs
 * cyan → magenta → amber on z-height with a fresnel rim and subtle pulse.
 */
export function VolatilitySurface({ sim }: Props) {
  const reduced = useReducedMotion();
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<InstanceType<typeof SurfaceMaterial>>(null);

  const geometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(5, 3.4, GRID, GRID);
    const positions = geom.attributes.position as THREE.BufferAttribute;
    const fragility = sim.catastrophicRisk / 100;
    const playoff = sim.playoffProbability / 100;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const r = Math.sqrt(x * x + y * y);
      const wave = Math.sin(r * 2.2 - playoff * 4) * 0.55;
      const bumps = Math.sin(x * 3 + sim.regretIndex / 12) * Math.cos(y * 2.5) * 0.35;
      const z = wave * (0.55 + fragility * 1.4) + bumps * playoff;
      positions.setZ(i, z);
    }
    positions.needsUpdate = true;
    geom.computeVertexNormals();
    return geom;
  }, [sim]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    // Keep x constant; sway y gently so the surface reads as a graph, not a spin
    if (meshRef.current) {
      meshRef.current.rotation.x = -Math.PI / 4;
      meshRef.current.rotation.y = 0.15 + Math.sin(t * 0.08) * 0.04;
    }
    if (wireRef.current) {
      wireRef.current.rotation.x = -Math.PI / 4;
      wireRef.current.rotation.y = 0.15 + Math.sin(t * 0.08) * 0.04;
    }
    if (materialRef.current) {
      (materialRef.current as unknown as { uTime: number }).uTime = t;
    }
  });

  return (
    <group>
      <StudioLighting />

      {/* Soft floor grid for depth reference */}
      <gridHelper args={[6, 12, "#1a2330", "#0c1119"]} position={[0, -1.45, 0]} />

      {/* Surface — tilted for a clear top-down perspective */}
      <mesh ref={meshRef} rotation={[-Math.PI / 4, 0.15, 0]} position={[0, -0.4, 0]}>
        <primitive object={geometry} attach="geometry" />
        <surfaceMaterial
          ref={materialRef}
          attach="material"
          uHeightScale={1.6}
          uIntensity={1.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Wireframe overlay traces the surface */}
      <mesh ref={wireRef} rotation={[-Math.PI / 4, 0.15, 0]} position={[0, -0.395, 0]}>
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial color="#0f1825" wireframe transparent opacity={0.32} />
      </mesh>
    </group>
  );
}
