"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import { mulberry32 } from "@/lib/simulation";
import { StudioLighting } from "../lighting/StudioLighting";
import { FlowMaterial } from "../shaders/flowMaterial";

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

/**
 * Draft Multiverse — branching tubes diverge from a single "NOW" sphere out
 * to outcome endpoints. Tube color stops + opacity encode branch probability;
 * the rendered glow scales with rosterDelta.
 */
export function DraftMultiverse({ branches = DEFAULT_BRANCHES, seed = 1019 }: Props) {
  const reduced = useReducedMotion();
  const groupRef = useRef<THREE.Group>(null);
  const materialRefs = useRef<InstanceType<typeof FlowMaterial>[]>([]);

  const tubes = useMemo(() => {
    const rng = mulberry32(seed);
    return branches.map((branch, i) => {
      const t = i / Math.max(branches.length - 1, 1);
      const startY = -1.5 + t * 3.0;
      const points: THREE.Vector3[] = [];
      points.push(new THREE.Vector3(-3, 0, 0));
      points.push(new THREE.Vector3(-1.2, startY * 0.4, (rng() - 0.5) * 0.6));
      points.push(new THREE.Vector3(0.4, startY * 0.7, (rng() - 0.5) * 0.6));
      points.push(new THREE.Vector3(2, startY, (rng() - 0.5) * 0.6));
      points.push(new THREE.Vector3(3.4, startY * 1.05, 0));
      const curve = new THREE.CatmullRomCurve3(points);
      const radius = 0.05 + branch.probability * 0.22;

      // Branch probability colors: high-prob = cyan/lime, low-prob = magenta/violet
      const hue = THREE.MathUtils.lerp(0.55, 0.85, branch.probability * 2.4);
      const colorStart = new THREE.Color().setHSL(Math.min(0.99, hue), 0.75, 0.6);
      const colorMid = new THREE.Color().setHSL(
        Math.min(0.99, hue + 0.08),
        0.75,
        0.6
      );
      const colorEnd = new THREE.Color().setHSL(
        Math.min(0.99, hue + 0.12),
        0.85,
        0.55
      );

      return {
        curve,
        radius,
        colorStart,
        colorMid,
        colorEnd,
        intensity: 0.9 + branch.probability * 2.4,
        endY: startY,
        prob: branch.probability,
        rosterDelta: branch.rosterDelta,
        progress: i * 0.13
      };
    });
  }, [branches, seed]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.y = Math.sin(t * 0.1) * 0.05;
    materialRefs.current.forEach((mat) => {
      if (mat) (mat as unknown as { uTime: number }).uTime = t;
    });
  });

  return (
    <group ref={groupRef}>
      <StudioLighting />

      {/* "NOW" source sphere */}
      <mesh position={[-3, 0, 0]}>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshStandardMaterial
          color="#7dd3fc"
          emissive="#7dd3fc"
          emissiveIntensity={2.0}
        />
      </mesh>
      <mesh position={[-3, 0, 0]}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.18} />
      </mesh>

      {tubes.map((tube, i) => (
        <group key={i}>
          <mesh>
            <tubeGeometry args={[tube.curve, 96, tube.radius, 14, false]} />
            <flowMaterial
              ref={(node) => {
                if (node) materialRefs.current[i] = node;
              }}
              attach="material"
              uColorStart={tube.colorStart}
              uColorMid={tube.colorMid}
              uColorEnd={tube.colorEnd}
              uIntensity={tube.intensity}
              uProgress={tube.progress}
              uOpacity={0.85 + tube.prob * 0.3}
              transparent
              depthWrite={false}
            />
          </mesh>
          {/* Endpoint sphere; size scales with probability */}
          <mesh position={[3.6, tube.endY * 1.05, 0]}>
            <sphereGeometry args={[0.1 + tube.prob * 0.22, 18, 18]} />
            <meshStandardMaterial
              color={tube.colorEnd}
              emissive={tube.colorEnd}
              emissiveIntensity={1.4}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
