"use client";

import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";

/**
 * Shared post-processing stack applied at the end of every WebGL scene.
 *
 * Effects:
 *   - Bloom — only the data-bright (emissive) pixels glow. Keeps the bloom
 *     attached to signal rather than letting it bleed into the cream UI.
 *   - Vignette — soft darken at edges so the canvas reads as inset into the
 *     graphite panel rather than a flat rectangle.
 *
 * This is the only Composer in the app, so multiple scenes do not stack
 * passes. Bloom uses `mipmapBlur` for cheap quality.
 */
export function PostFX({ bloomIntensity = 0.95 }: { bloomIntensity?: number }) {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={0.3}
        luminanceSmoothing={0.5}
        mipmapBlur
        kernelSize={KernelSize.LARGE}
      />
      <Vignette
        eskil={false}
        offset={0.48}
        darkness={0.65}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  );
}
