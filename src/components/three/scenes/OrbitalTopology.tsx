"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import { marketInefficiency, narrativeVelocity } from "@/lib/models";

interface Props {
  players: PlayerMarketRecord[];
  autoRotateSpeed?: number;
}

export function OrbitalTopology({ players, autoRotateSpeed = 0.06 }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const reduced = useReducedMotion();
  const invalidate = useThree((state) => state.invalidate);

  const nodes = useMemo(() => {
    const count = Math.max(players.length, 1);
    return players.map((p, i) => {
      const phi = Math.acos(-1 + (2 * (i + 0.5)) / count);
      const theta = Math.sqrt(count * Math.PI) * phi;
      const radius = 2.4 + (p.trueValue - 50) / 60;
      const position: [number, number, number] = [
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi)
      ];
      const colorHex = colorForPosition(p.position);
      return {
        position,
        size: 0.08 + (p.trueValue / 100) * 0.16,
        color: new THREE.Color(colorHex),
        emissive: new THREE.Color(colorHex).multiplyScalar(0.45 + narrativeVelocity(p) / 220),
        edgeBrightness: 0.2 + marketInefficiency(p) / 130
      };
    });
  }, [players]);

  const edges = useMemo(() => {
    const lines: Array<{ a: [number, number, number]; b: [number, number, number]; bright: number }> = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = a.position[0] - b.position[0];
        const dy = a.position[1] - b.position[1];
        const dz = a.position[2] - b.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 3.6) {
          lines.push({
            a: a.position,
            b: b.position,
            bright: 0.06 + (1 - dist / 3.6) * Math.max(a.edgeBrightness, b.edgeBrightness)
          });
        }
      }
    }
    return lines;
  }, [nodes]);

  useFrame((_, delta) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.y += delta * autoRotateSpeed;
    invalidate();
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.55} />
      <pointLight position={[5, 5, 5]} intensity={1.0} color="#bcd6ff" />
      <pointLight position={[-4, -3, 4]} intensity={0.45} color="#ffb27a" />
      {nodes.map((node, idx) => (
        <mesh key={idx} position={node.position}>
          <sphereGeometry args={[node.size, 16, 16]} />
          <meshStandardMaterial
            color={node.color}
            emissive={node.emissive}
            emissiveIntensity={1.2}
            metalness={0.2}
            roughness={0.35}
          />
        </mesh>
      ))}
      {edges.map((edge, idx) => (
        <Edge key={idx} a={edge.a} b={edge.b} brightness={edge.bright} />
      ))}
    </group>
  );
}

function Edge({ a, b, brightness }: { a: [number, number, number]; b: [number, number, number]; brightness: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b], 3));
    return g;
  }, [a, b]);
  const color = useMemo(() => new THREE.Color().setHSL(0.55, 0.5, 0.4 + brightness * 0.4), [brightness]);
  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={Math.min(1, 0.25 + brightness)} />
    </line>
  );
}

function colorForPosition(position: PlayerMarketRecord["position"]): string {
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
    default:
      return "#94a3b8";
  }
}
