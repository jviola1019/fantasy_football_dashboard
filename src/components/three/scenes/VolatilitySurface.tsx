"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { SimulationResult } from "@/lib/simulation";

interface Props {
  sim: SimulationResult;
}

const GRID = 32;

export function VolatilitySurface({ sim }: Props) {
  const reduced = useReducedMotion();
  const meshRef = useRef<THREE.Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  const geometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(5, 3.2, GRID, GRID);
    const positions = geom.attributes.position as THREE.BufferAttribute;
    const fragility = sim.catastrophicRisk / 100;
    const playoff = sim.playoffProbability / 100;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const r = Math.sqrt(x * x + y * y);
      const wave = Math.sin(r * 2.2 - playoff * 4) * 0.45;
      const bumps = Math.sin(x * 3 + sim.regretIndex / 12) * Math.cos(y * 2.5) * 0.3;
      const z = wave * (0.5 + fragility * 1.2) + bumps * playoff;
      positions.setZ(i, z);
    }
    positions.needsUpdate = true;
    geom.computeVertexNormals();
    return geom;
  }, [sim]);

  useFrame((state) => {
    if (reduced || !meshRef.current) return;
    meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.12) * 0.04;
    invalidate();
  });

  const colorTop = useMemo(() => new THREE.Color("#7dd3fc"), []);
  const colorBottom = useMemo(() => new THREE.Color("#9b7fe8"), []);

  return (
    <group>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} color="#d3e8ff" />
      <directionalLight position={[-4, -2, 2]} intensity={0.35} color="#f6c8ff" />
      <mesh ref={meshRef} rotation={[-Math.PI / 3, 0, 0]} position={[0, -0.3, 0]}>
        <primitive object={geometry} attach="geometry" />
        <meshStandardMaterial
          color={colorTop}
          emissive={colorBottom}
          emissiveIntensity={0.18}
          metalness={0.25}
          roughness={0.55}
          wireframe={false}
          flatShading
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 3, 0, 0]} position={[0, -0.299, 0]}>
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial color={"#0f1825"} wireframe transparent opacity={0.35} />
      </mesh>
    </group>
  );
}
