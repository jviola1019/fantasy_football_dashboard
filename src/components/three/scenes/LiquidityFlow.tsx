"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import { MeshReflectorMaterial } from "@react-three/drei";
import type { PlayerMarketRecord } from "@/lib/governance";
import { liquidityScore, marketInefficiency } from "@/lib/models";
import { StudioLighting } from "../lighting/StudioLighting";
// `flowMaterial` is registered with R3F via a module-level `extend()` side
// effect. The `FlowMaterial` symbol below is referenced only in a type
// position, so the bundler (SWC/Turbopack) would otherwise elide the whole
// module and the `<flowMaterial>` intrinsic would be unknown to R3F. The bare
// import keeps the side effect alive.
import "../shaders/flowMaterial";
import type { FlowMaterial } from "../shaders/flowMaterial";

interface Props {
  players: PlayerMarketRecord[];
}

interface Ribbon {
  curve: THREE.CubicBezierCurve3;
  radius: number;
  colorStart: THREE.Color;
  colorMid: THREE.Color;
  colorEnd: THREE.Color;
  intensity: number;
  progress: number;
}

/**
 * Liquidity Flow ribbons — gradient-shimmer tubes whose color stops and
 * intensity encode liquidityScore and marketInefficiency. Blueprint match:
 * cyan → magenta → amber arcs sweeping across a graphite reflective ground.
 */
export function LiquidityFlow({ players }: Props) {
  const reduced = useReducedMotion();
  const materialRefs = useRef<InstanceType<typeof FlowMaterial>[]>([]);

  const ribbons = useMemo<Ribbon[]>(() => {
    if (players.length === 0) return [];
    const top = [...players].sort((a, b) => liquidityScore(b) - liquidityScore(a)).slice(0, 8);
    return top.map((p, i) => {
      const t = i / Math.max(top.length - 1, 1);
      const ySpread = (t - 0.5) * 2.4;
      const start = new THREE.Vector3(-3.2 + t * 0.3, ySpread, -0.5);
      const ctrl1 = new THREE.Vector3(-1.4, ySpread + Math.sin(i * 0.9) * 0.8, 0.7);
      const ctrl2 = new THREE.Vector3(0.9, -ySpread + Math.cos(i * 0.7) * 0.7, -0.7);
      const end = new THREE.Vector3(3.2, -ySpread, 0.4);
      const curve = new THREE.CubicBezierCurve3(start, ctrl1, ctrl2, end);
      const liq = liquidityScore(p);
      const ineff = marketInefficiency(p);
      const radius = 0.055 + Math.min(liq / 25, 0.06);

      // Three-color gradient seeded from liquidity + inefficiency
      const hueStart = THREE.MathUtils.lerp(0.55, 0.6, Math.min(liq / 12, 1));
      const hueMid = THREE.MathUtils.lerp(0.78, 0.9, Math.min(ineff / 30, 1));
      const hueEnd = 0.12;

      return {
        curve,
        radius,
        colorStart: new THREE.Color().setHSL(hueStart, 0.75, 0.6),
        colorMid: new THREE.Color().setHSL(hueMid, 0.75, 0.62),
        colorEnd: new THREE.Color().setHSL(hueEnd, 0.85, 0.6),
        intensity: 1.0 + Math.min(liq / 15, 0.8),
        progress: i * 0.15
      };
    });
  }, [players]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    materialRefs.current.forEach((mat) => {
      if (mat) {
        (mat as unknown as { uTime: number }).uTime = t;
      }
    });
  });

  return (
    <group>
      <StudioLighting />

      {/* Reflective ground catches the ribbon glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]}>
        <planeGeometry args={[18, 14]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={512}
          mixBlur={1}
          mixStrength={1.2}
          roughness={0.85}
          depthScale={1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#0c1119"
          metalness={0.5}
        />
      </mesh>

      {ribbons.map((ribbon, i) => (
        <mesh key={i}>
          <tubeGeometry args={[ribbon.curve, 96, ribbon.radius, 14, false]} />
          <flowMaterial
            ref={(node) => {
              if (node) materialRefs.current[i] = node;
            }}
            attach="material"
            uColorStart={ribbon.colorStart}
            uColorMid={ribbon.colorMid}
            uColorEnd={ribbon.colorEnd}
            uIntensity={ribbon.intensity}
            uProgress={ribbon.progress}
            uOpacity={0.95}
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
