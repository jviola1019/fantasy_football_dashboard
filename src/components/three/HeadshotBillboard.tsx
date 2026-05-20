"use client";

import { Billboard } from "@react-three/drei";
import { useEffect, useState } from "react";
import * as THREE from "three";

interface Props {
  url: string;
  position: [number, number, number];
  /** Radius of the billboard sprite in world units. */
  size?: number;
  /** Halo color rendered behind the headshot to integrate it with the scene. */
  haloColor?: string;
}

/**
 * Player headshot rendered as an always-camera-facing sprite inside a 3-D
 * scene. Used by OrbitalTopology and PlayerGalaxy to put faces on the
 * highest-signal player nodes.
 *
 * The texture is loaded IMPERATIVELY (not via `useLoader`). `useLoader` throws
 * the load rejection past <Suspense> straight to the nearest error boundary —
 * a single 404 from the headshot CDN would crash the whole dashboard. Here a
 * failed load just leaves the colored halo disc in place.
 */
export function HeadshotBillboard({ url, position, size = 0.32, haloColor = "#7dd3fc" }: Props) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
      },
      undefined,
      () => {
        // Load failed (404 / network / CORS) — keep the fallback disc.
        if (!cancelled) setTexture(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      {/* Halo ring — always rendered so the node reads even before/without the photo */}
      <mesh position={[0, 0, -0.02]}>
        <ringGeometry args={[size * 1.05, size * 1.35, 48]} />
        <meshBasicMaterial color={haloColor} transparent opacity={0.6} />
      </mesh>
      <mesh>
        <circleGeometry args={[size, 48]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial color={haloColor} transparent opacity={0.5} />
        )}
      </mesh>
    </Billboard>
  );
}
