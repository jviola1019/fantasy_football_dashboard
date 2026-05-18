"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import { mulberry32 } from "@/lib/simulation";

interface Branch {
  probability: number;
  label: string;
  rosterDelta: number;
}

interface Props {
  branches?: Branch[];
  seed?: number;
}

const DEFAULT_BRANCHES: Branch[] = [
  { probability: 0.34, label: "WR-RB-RB", rosterDelta: 12 },
  { probability: 0.22, label: "RB-WR-WR", rosterDelta: 9 },
  { probability: 0.18, label: "WR-WR-RB", rosterDelta: 8 },
  { probability: 0.13, label: "QB-RB-WR", rosterDelta: 6 },
  { probability: 0.08, label: "TE-RB-WR", rosterDelta: 4 },
  { probability: 0.05, label: "RB-TE-WR", rosterDelta: 3 }
];

export function DraftMultiverse({ branches = DEFAULT_BRANCHES, seed = 1019 }: Props) {
  const reduced = useReducedMotion();
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);

  const tubes = useMemo(() => {
    const rng = mulberry32(seed);
    return branches.map((branch, i) => {
      const t = i / Math.max(branches.length - 1, 1);
      const startY = -1.4 + t * 2.8;
      const points: THREE.Vector3[] = [];
      points.push(new THREE.Vector3(-3, 0, 0));
      points.push(new THREE.Vector3(-1.2, startY * 0.4, (rng() - 0.5) * 0.6));
      points.push(new THREE.Vector3(0.4, startY * 0.7, (rng() - 0.5) * 0.6));
      points.push(new THREE.Vector3(2, startY, (rng() - 0.5) * 0.6));
      points.push(new THREE.Vector3(3.2, startY * 1.05, 0));
      const curve = new THREE.CatmullRomCurve3(points);
      const radius = 0.04 + branch.probability * 0.18;
      const hue = THREE.MathUtils.lerp(0.55, 0.85, branch.probability * 2.4);
      const color = new THREE.Color().setHSL(Math.min(0.99, hue), 0.7, 0.55);
      return { curve, radius, color, label: branch.label, prob: branch.probability, endY: startY };
    });
  }, [branches, seed]);

  useFrame((state) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.1) * 0.06;
    invalidate();
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.55} />
      <pointLight position={[3, 4, 4]} intensity={0.9} color="#9bd1ff" />
      <pointLight position={[-3, -2, 3]} intensity={0.5} color="#f0abfc" />
      <mesh position={[-3, 0, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={1.4} />
      </mesh>
      {tubes.map((tube, i) => (
        <group key={i}>
          <mesh>
            <tubeGeometry args={[tube.curve, 80, tube.radius, 12, false]} />
            <meshStandardMaterial
              color={tube.color}
              emissive={tube.color}
              emissiveIntensity={0.85}
              metalness={0.3}
              roughness={0.4}
              transparent
              opacity={0.85}
            />
          </mesh>
          <mesh position={[3.4, tube.endY * 1.05, 0]}>
            <sphereGeometry args={[0.08 + tube.prob * 0.16, 16, 16]} />
            <meshStandardMaterial color={tube.color} emissive={tube.color} emissiveIntensity={1.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
