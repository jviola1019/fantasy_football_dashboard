"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import { narrativeVelocity } from "@/lib/models";
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

/**
 * Narrative Engine ribbons — Catmull-Rom curves swept into tubes with the
 * shared flow shader. Color stops encode direction: green-cyan for positive
 * momentum, magenta-purple for negative.
 */
export function NarrativeField({ players }: Props) {
  const reduced = useReducedMotion();
  const groupRef = useRef<THREE.Group>(null);
  const materialRefs = useRef<InstanceType<typeof FlowMaterial>[]>([]);

  const ribbons = useMemo(() => {
    const top = [...players]
      .map((p) => ({ player: p, vel: narrativeVelocity(p) }))
      .sort((a, b) => Math.abs(b.vel) - Math.abs(a.vel))
      .slice(0, 5);
    return top.map(({ player, vel }, idx) => {
      const baseY = (idx - 2) * 0.55;
      const points: THREE.Vector3[] = [];
      const segments = 60;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = -3 + t * 6;
        const y = baseY + Math.sin(t * Math.PI * 2 + idx) * 0.28 * (vel / 60);
        const z = Math.cos(t * Math.PI * 1.5 + idx) * 0.45 * (vel / 80);
        points.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const positive = vel >= 0;
      return {
        id: player.id,
        curve,
        radius: 0.05 + Math.min(Math.abs(vel) / 180, 0.06),
        colorStart: positive ? new THREE.Color("#7dd3fc") : new THREE.Color("#f0abfc"),
        colorMid: positive ? new THREE.Color("#a7f3d0") : new THREE.Color("#c4b5fd"),
        colorEnd: positive ? new THREE.Color("#fbbf24") : new THREE.Color("#fca5a5"),
        intensity: 1.0 + Math.min(Math.abs(vel) / 90, 0.6),
        progress: idx * 0.18
      };
    });
  }, [players]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.y = Math.sin(t * 0.1) * 0.06;
    materialRefs.current.forEach((mat) => {
      if (mat) (mat as unknown as { uTime: number }).uTime = t;
    });
  });

  return (
    <group ref={groupRef}>
      <StudioLighting />
      {ribbons.map((ribbon, i) => (
        <mesh key={ribbon.id}>
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
            uOpacity={0.92}
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
