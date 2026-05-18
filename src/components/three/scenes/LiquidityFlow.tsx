"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import { liquidityScore, marketInefficiency } from "@/lib/models";

interface Props {
  players: PlayerMarketRecord[];
  /** Per-ribbon flow speed multiplier. */
  speed?: number;
  /** Color override for the secondary stop. */
  accent?: string;
}

export function LiquidityFlow({ players, speed = 0.35, accent = "#f0abfc" }: Props) {
  const reduced = useReducedMotion();
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);

  const ribbons = useMemo(() => {
    if (players.length === 0) return [];
    const top = [...players].sort((a, b) => liquidityScore(b) - liquidityScore(a)).slice(0, 6);
    return top.map((p, i) => {
      const t = i / Math.max(top.length - 1, 1);
      const start = new THREE.Vector3(-3 + t * 0.4, -1.2 + t * 2.4, -0.4);
      const ctrl1 = new THREE.Vector3(-1.4, 0.6 + Math.sin(i) * 0.6, 0.6);
      const ctrl2 = new THREE.Vector3(0.8, -0.4 + Math.cos(i * 0.7) * 0.7, -0.6);
      const end = new THREE.Vector3(3, -0.8 + t * 1.6, 0.4);
      const curve = new THREE.CubicBezierCurve3(start, ctrl1, ctrl2, end);
      const tubeRadius = 0.045 + (liquidityScore(p) / 30);
      const ineff = marketInefficiency(p);
      const hue = THREE.MathUtils.lerp(0.55, 0.85, Math.min(ineff / 30, 1));
      const color = new THREE.Color().setHSL(hue, 0.7, 0.55);
      return { curve, radius: tubeRadius, color, offset: i * 0.13 };
    });
  }, [players]);

  const meshRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.getElapsedTime();
    meshRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat) {
        const ribbon = ribbons[i];
        const pulse = 0.65 + 0.35 * Math.sin(t * speed + ribbon!.offset * Math.PI * 2);
        mat.emissiveIntensity = pulse;
      }
    });
    invalidate();
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.6} />
      <pointLight position={[4, 4, 4]} intensity={0.8} color="#9bd1ff" />
      <pointLight position={[-4, -2, 2]} intensity={0.5} color={accent} />
      {ribbons.map((ribbon, i) => (
        <mesh
          key={i}
          ref={(node) => {
            if (node) meshRefs.current[i] = node;
          }}
        >
          <tubeGeometry args={[ribbon.curve, 64, ribbon.radius, 12, false]} />
          <meshStandardMaterial
            color={ribbon.color}
            emissive={ribbon.color}
            emissiveIntensity={0.8}
            metalness={0.3}
            roughness={0.4}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
  );
}
