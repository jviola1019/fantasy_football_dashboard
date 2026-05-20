"use client";

import { shaderMaterial } from "@react-three/drei";
import { extend } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Gradient + animated shimmer material used by LiquidityFlow and
 * DraftMultiverse ribbons.
 *
 * Uniforms:
 *   uTime         — clock seconds; drives the shimmer + flow direction
 *   uColorStart   — start of the arc gradient (RGB)
 *   uColorMid     — mid stop
 *   uColorEnd     — end stop
 *   uIntensity    — overall emissive multiplier (0..2)
 *   uOpacity      — base alpha (0..1)
 *   uProgress     — arc-length position used to slide the gradient along the ribbon
 */
export const FlowMaterial = shaderMaterial(
  {
    uTime: 0,
    uColorStart: new THREE.Color("#7dd3fc"),
    uColorMid: new THREE.Color("#f0abfc"),
    uColorEnd: new THREE.Color("#fbbf24"),
    uIntensity: 1.2,
    uOpacity: 0.92,
    uProgress: 0.0
  },
  // vertex shader
  /* glsl */ `
    varying vec2 vUv;
    varying float vDist;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  // fragment shader
  /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uColorStart;
    uniform vec3 uColorMid;
    uniform vec3 uColorEnd;
    uniform float uIntensity;
    uniform float uOpacity;
    uniform float uProgress;
    varying vec2 vUv;
    varying float vDist;

    // Cheap 3-stop gradient
    vec3 grad(float t) {
      vec3 a = mix(uColorStart, uColorMid, smoothstep(0.0, 0.5, t));
      return mix(a, uColorEnd, smoothstep(0.5, 1.0, t));
    }

    void main() {
      // u runs along the tube length; v runs around the tube circumference
      float t = fract(vUv.x + uTime * 0.06 + uProgress);
      vec3 base = grad(t);

      // Edge softness so ribbons don't read as flat ribbons
      float edge = 1.0 - pow(abs(vUv.y * 2.0 - 1.0), 1.6);
      // Animated shimmer band
      float shimmer = 0.5 + 0.5 * sin((vUv.x * 14.0) - uTime * 2.2);
      float glow = mix(0.55, 1.4, shimmer);

      vec3 col = base * uIntensity * glow * edge;
      float alpha = uOpacity * edge;
      // Distance fog fade so close ribbons aren't blown out
      alpha *= clamp(1.0 - (vDist - 3.0) * 0.05, 0.35, 1.0);
      gl_FragColor = vec4(col, alpha);
    }
  `
);

extend({ FlowMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    flowMaterial: import("@react-three/fiber").ThreeElement<typeof FlowMaterial>;
  }
}
