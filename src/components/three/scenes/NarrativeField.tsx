"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import { narrativeVelocity } from "@/lib/models";

interface Props {
  players: PlayerMarketRecord[];
}

export function NarrativeField({ players }: Props) {
  const reduced = useReducedMotion();
  const groupRef = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);

  const ribbons = useMemo(() => {
    const top = [...players]
      .map((p) => ({ player: p, vel: narrativeVelocity(p) }))
      .sort((a, b) => Math.abs(b.vel) - Math.abs(a.vel))
      .slice(0, 5);
    return top.map(({ player, vel }, idx) => {
      const baseY = (idx - 2) * 0.5;
      const points: THREE.Vector3[] = [];
      const segments = 60;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = -3 + t * 6;
        const y = baseY + Math.sin(t * Math.PI * 2 + idx) * 0.25 * (vel / 60);
        const z = Math.cos(t * Math.PI * 1.5 + idx) * 0.4 * (vel / 80);
        points.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const positive = vel >= 0;
      return {
        curve,
        radius: 0.04 + Math.min(Math.abs(vel) / 200, 0.06),
        color: positive ? "#a7f3d0" : "#f0abfc",
        emissiveBoost: Math.min(0.6 + Math.abs(vel) / 120, 1.4),
        label: player.name
      };
    });
  }, [players]);

  useFrame((state) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.1) * 0.08;
    invalidate();
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 4, 4]} intensity={0.9} color="#a7d8ff" />
      <pointLight position={[-3, -2, 2]} intensity={0.5} color="#f5b6ff" />
      {ribbons.map((ribbon, i) => (
        <mesh key={i}>
          <tubeGeometry args={[ribbon.curve, 80, ribbon.radius, 12, false]} />
          <meshStandardMaterial
            color={ribbon.color}
            emissive={ribbon.color}
            emissiveIntensity={ribbon.emissiveBoost}
            metalness={0.25}
            roughness={0.4}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
  );
}
