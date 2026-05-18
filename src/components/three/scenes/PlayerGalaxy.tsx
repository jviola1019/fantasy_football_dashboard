"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import { mulberry32 } from "@/lib/simulation";

interface Props {
  players: PlayerMarketRecord[];
  selectedId?: string | null;
}

export function PlayerGalaxy({ players, selectedId }: Props) {
  const reduced = useReducedMotion();
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);
  const instancedRef = useRef<THREE.InstancedMesh>(null);

  const items = useMemo(() => {
    return players.map((p, i) => {
      const theta = (i / Math.max(players.length, 1)) * Math.PI * 2;
      const radius = 1.6 + (p.opportunity / 100) * 1.6;
      const y = (p.trueValue - p.perceivedValue) / 50;
      return {
        id: p.id,
        position: new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius),
        color: new THREE.Color(positionColor(p.position)),
        scale: 0.08 + (p.confidence ?? 0) * 0.18
      };
    });
  }, [players]);

  useEffect(() => {
    const mesh = instancedRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    items.forEach((node, i) => {
      dummy.position.copy(node.position);
      const scale = node.id === selectedId ? node.scale * 1.8 : node.scale;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, node.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, selectedId]);

  useFrame((state, delta) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.05;
    // Subtle individual oscillation
    const mesh = instancedRef.current;
    if (mesh) {
      const dummy = new THREE.Object3D();
      const t = state.clock.elapsedTime;
      items.forEach((node, i) => {
        dummy.position.copy(node.position);
        dummy.position.y += Math.sin(t * 0.5 + i) * 0.05;
        const scale = node.id === selectedId ? node.scale * 1.8 : node.scale;
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    invalidate();
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.5} />
      <pointLight position={[6, 4, 6]} intensity={0.9} color="#bcd6ff" />
      <BackdropStars />
      {items.length > 0 ? (
        <instancedMesh ref={instancedRef} args={[undefined, undefined, items.length]}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshStandardMaterial vertexColors emissive="#1d2433" emissiveIntensity={0.55} metalness={0.3} roughness={0.4} />
        </instancedMesh>
      ) : null}
    </group>
  );
}

function BackdropStars() {
  const ref = useRef<THREE.Points>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = 300;
    const positions = new Float32Array(count * 3);
    const rng = mulberry32(2026);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() - 0.5) * 18;
      positions[i * 3 + 1] = (rng() - 0.5) * 12;
      positions[i * 3 + 2] = -4 - rng() * 6;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  return (
    <points ref={ref}>
      <primitive object={geom} attach="geometry" />
      <pointsMaterial color="#9bb3c8" size={0.025} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

function positionColor(position: PlayerMarketRecord["position"]): string {
  switch (position) {
    case "QB":
      return "#7dd3fc";
    case "RB":
      return "#a7f3d0";
    case "WR":
      return "#f0abfc";
    case "TE":
      return "#fbbf24";
    case "K":
      return "#fca5a5";
    case "DEF":
      return "#c4b5fd";
  }
}
