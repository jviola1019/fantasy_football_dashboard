"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import { Ring } from "@react-three/drei";
import type { PlayerMarketRecord } from "@/lib/governance";
import { marketInefficiency, narrativeVelocity } from "@/lib/models";
import { StudioLighting } from "../lighting/StudioLighting";
import { HeadshotBillboard } from "../HeadshotBillboard";

interface Props {
  players: PlayerMarketRecord[];
  autoRotateSpeed?: number;
}

/**
 * Command Center "League Pulse" — orbital network of players, sized by trueValue,
 * connected by edges whose brightness encodes market inefficiency. The top 5
 * trueValue players get headshot billboards (blueprint match).
 */
export function OrbitalTopology({ players, autoRotateSpeed = 0.06 }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const reduced = useReducedMotion();

  const nodes = useMemo(() => {
    const count = Math.max(players.length, 1);
    return players.map((p, i) => {
      // Spherical Fibonacci distribution — looks like the blueprint's lattice
      const phi = Math.acos(-1 + (2 * (i + 0.5)) / count);
      const theta = Math.sqrt(count * Math.PI) * phi;
      const radius = 2.3 + (p.trueValue - 50) / 55;
      const position: [number, number, number] = [
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi) * 0.85,
        radius * Math.cos(phi) * 0.7
      ];
      const colorHex = colorForPosition(p.position);
      const c = new THREE.Color(colorHex);
      return {
        player: p,
        position,
        size: 0.09 + (p.trueValue / 100) * 0.14,
        color: c,
        emissive: c.clone().multiplyScalar(0.6 + Math.abs(narrativeVelocity(p)) / 180),
        edgeBrightness: 0.18 + marketInefficiency(p) / 110
      };
    });
  }, [players]);

  const edges = useMemo(() => {
    const lines: Array<{ from: THREE.Vector3; to: THREE.Vector3; bright: number; color: THREE.Color }> = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const from = new THREE.Vector3(...a.position);
        const to = new THREE.Vector3(...b.position);
        const dist = from.distanceTo(to);
        if (dist < 3.6) {
          const bright = 0.1 + (1 - dist / 3.6) * Math.max(a.edgeBrightness, b.edgeBrightness);
          lines.push({
            from,
            to,
            bright,
            color: a.color.clone().lerp(b.color, 0.5)
          });
        }
      }
    }
    return lines;
  }, [nodes]);

  const topHeadshots = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => b.player.trueValue - a.player.trueValue)
        .slice(0, 5),
    [nodes]
  );

  useFrame((_, delta) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.y += delta * autoRotateSpeed;
  });

  return (
    <group ref={groupRef}>
      <StudioLighting />

      {/* Decorative orbital rings on the equatorial plane */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        <Ring args={[1.6, 1.605, 96]}>
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.18} side={THREE.DoubleSide} />
        </Ring>
        <Ring args={[2.4, 2.408, 96]}>
          <meshBasicMaterial color="#a7f3d0" transparent opacity={0.13} side={THREE.DoubleSide} />
        </Ring>
        <Ring args={[3.2, 3.21, 96]}>
          <meshBasicMaterial color="#f0abfc" transparent opacity={0.1} side={THREE.DoubleSide} />
        </Ring>
      </group>

      {nodes.map((node, idx) => (
        <group key={idx}>
          {/* Halo */}
          <mesh position={node.position}>
            <sphereGeometry args={[node.size * 1.8, 16, 16]} />
            <meshBasicMaterial color={node.color} transparent opacity={0.12} />
          </mesh>
          {/* Core */}
          <mesh position={node.position}>
            <sphereGeometry args={[node.size, 24, 24]} />
            <meshStandardMaterial
              color={node.color}
              emissive={node.emissive}
              emissiveIntensity={1.6}
              metalness={0.35}
              roughness={0.28}
            />
          </mesh>
        </group>
      ))}

      {edges.map((edge, idx) => (
        <Edge key={idx} from={edge.from} to={edge.to} brightness={edge.bright} color={edge.color} />
      ))}

      {topHeadshots.map(
        (node) =>
          node.player.imageUrl && (
            <HeadshotBillboard
              key={node.player.id}
              url={node.player.imageUrl}
              position={[node.position[0] * 1.15, node.position[1] * 1.15 + 0.25, node.position[2] * 1.15]}
              size={0.28}
              haloColor={`#${node.color.getHexString()}`}
            />
          )
      )}
    </group>
  );
}

function Edge({
  from,
  to,
  brightness,
  color
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  brightness: number;
  color: THREE.Color;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([from.x, from.y, from.z, to.x, to.y, to.z], 3)
    );
    return g;
  }, [from, to]);
  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial
        color={color}
        transparent
        opacity={Math.min(1, 0.35 + brightness * 0.85)}
      />
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
