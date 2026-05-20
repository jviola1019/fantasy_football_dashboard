"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import { Ring } from "@react-three/drei";
import type { PlayerMarketRecord } from "@/lib/governance";
import { StudioLighting } from "../lighting/StudioLighting";
import { HeadshotBillboard } from "../HeadshotBillboard";

interface Props {
  players: PlayerMarketRecord[];
  selectedId?: string | null;
}

interface GalaxyNode {
  id: string;
  player: PlayerMarketRecord;
  basePosition: THREE.Vector3;
  color: THREE.Color;
  radius: number;
  ring: number;
}

const RING_RADII = [1.8, 2.7, 3.6];

/**
 * Player Universe galaxy. Each player is an individually-rendered glowing
 * sphere (halo + emissive core) — not an InstancedMesh, so per-node color is
 * always applied correctly. Players are distributed across three orbital rings
 * and evenly spaced around each ring so the cluster never collapses.
 */
export function PlayerGalaxy({ players, selectedId }: Props) {
  const reduced = useReducedMotion();
  const groupRef = useRef<THREE.Group>(null);
  const nodeRefs = useRef<Map<string, THREE.Group>>(new Map());

  const nodes = useMemo<GalaxyNode[]>(() => {
    // Spread players across the three rings, then space them evenly *within*
    // each ring so neighbours never overlap regardless of player count.
    const perRing: PlayerMarketRecord[][] = [[], [], []];
    players.forEach((p, i) => {
      perRing[i % 3]!.push(p);
    });

    const out: GalaxyNode[] = [];
    perRing.forEach((ringPlayers, ringIdx) => {
      const radius = RING_RADII[ringIdx]!;
      const count = Math.max(ringPlayers.length, 1);
      ringPlayers.forEach((p, j) => {
        // Even angular spacing + a per-ring phase offset so rings don't line up.
        const theta = (j / count) * Math.PI * 2 + ringIdx * 0.6;
        const y = ((p.trueValue - p.perceivedValue) / 50) * 0.9;
        out.push({
          id: p.id,
          player: p,
          basePosition: new THREE.Vector3(
            Math.cos(theta) * radius,
            y,
            Math.sin(theta) * radius
          ),
          color: new THREE.Color(positionColor(p.position)),
          radius: 0.16 + (p.confidence ?? 0) * 0.22,
          ring: ringIdx
        });
      });
    });
    return out;
  }, [players]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  );

  useFrame((state, delta) => {
    if (reduced) return;
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.04;
    const t = state.clock.elapsedTime;
    for (const node of nodes) {
      const g = nodeRefs.current.get(node.id);
      if (g) {
        g.position.y = node.basePosition.y + Math.sin(t * 0.5 + node.ring) * 0.06;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <StudioLighting />

      {/* Three orbital ring guides on the equatorial plane */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        <Ring args={[RING_RADII[0]! - 0.01, RING_RADII[0]! + 0.01, 96]}>
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.24} side={THREE.DoubleSide} />
        </Ring>
        <Ring args={[RING_RADII[1]! - 0.01, RING_RADII[1]! + 0.01, 96]}>
          <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} side={THREE.DoubleSide} />
        </Ring>
        <Ring args={[RING_RADII[2]! - 0.01, RING_RADII[2]! + 0.01, 96]}>
          <meshBasicMaterial color="#f0abfc" transparent opacity={0.16} side={THREE.DoubleSide} />
        </Ring>
      </group>

      {nodes.map((node) => {
        const isSelected = node.id === selectedId;
        const coreRadius = isSelected ? node.radius * 1.5 : node.radius;
        return (
          <group
            key={node.id}
            ref={(g) => {
              if (g) nodeRefs.current.set(node.id, g);
              else nodeRefs.current.delete(node.id);
            }}
            position={node.basePosition}
          >
            {/* Outer halo */}
            <mesh>
              <sphereGeometry args={[coreRadius * 2.1, 18, 18]} />
              <meshBasicMaterial color={node.color} transparent opacity={0.14} />
            </mesh>
            {/* Emissive core */}
            <mesh>
              <sphereGeometry args={[coreRadius, 28, 28]} />
              <meshStandardMaterial
                color={node.color}
                emissive={node.color}
                emissiveIntensity={isSelected ? 2.2 : 1.4}
                metalness={0.3}
                roughness={0.3}
              />
            </mesh>
          </group>
        );
      })}

      {selectedNode && selectedNode.player.imageUrl && (
        <HeadshotBillboard
          url={selectedNode.player.imageUrl}
          position={[
            selectedNode.basePosition.x,
            selectedNode.basePosition.y + 0.7,
            selectedNode.basePosition.z
          ]}
          size={0.36}
          haloColor={`#${selectedNode.color.getHexString()}`}
        />
      )}
    </group>
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
    default:
      return "#94a3b8";
  }
}
