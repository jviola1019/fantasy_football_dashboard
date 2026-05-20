"use client";

import { shaderMaterial } from "@react-three/drei";
import { extend } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Volatility surface material. Height-driven gradient with fresnel rim +
 * subtle animated wave overlay. Drives the blueprint's signature 3-D terrain.
 *
 * Uniforms:
 *   uTime          — clock seconds
 *   uColorLow      — color of the valleys
 *   uColorMid      — mid-elevation
 *   uColorHigh     — peaks
 *   uHeightScale   — divides z into 0..1 for the gradient lookup
 *   uIntensity     — overall emissive multiplier
 */
export const SurfaceMaterial = shaderMaterial(
  {
    uTime: 0,
    uColorLow: new THREE.Color("#7dd3fc"),
    uColorMid: new THREE.Color("#9b7fe8"),
    uColorHigh: new THREE.Color("#fbbf24"),
    uHeightScale: 1.6,
    uIntensity: 1.1
  },
  // vertex shader — passes object-space height and view-space normal
  /* glsl */ `
    varying float vHeight;
    varying vec3 vNormalV;
    varying vec3 vViewDir;
    void main() {
      vHeight = position.z;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormalV = normalize(normalMatrix * normal);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  // fragment shader
  /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uColorLow;
    uniform vec3 uColorMid;
    uniform vec3 uColorHigh;
    uniform float uHeightScale;
    uniform float uIntensity;
    varying float vHeight;
    varying vec3 vNormalV;
    varying vec3 vViewDir;

    vec3 grad(float t) {
      vec3 a = mix(uColorLow, uColorMid, smoothstep(0.0, 0.55, t));
      return mix(a, uColorHigh, smoothstep(0.55, 1.0, t));
    }

    void main() {
      float t = clamp((vHeight + uHeightScale) / (2.0 * uHeightScale), 0.0, 1.0);
      vec3 base = grad(t);
      // Lambertian shading
      float diff = max(dot(vNormalV, normalize(vec3(0.4, 0.6, 0.8))), 0.0);
      // Fresnel rim — picks out the silhouette
      float fres = pow(1.0 - max(dot(vNormalV, vViewDir), 0.0), 2.4);
      // Subtle animated overlay so the surface breathes
      float pulse = 0.96 + 0.04 * sin(uTime * 0.8 + vHeight * 4.0);

      vec3 col = base * (0.32 + 0.72 * diff) * pulse * uIntensity;
      col += fres * vec3(0.95, 0.85, 1.0) * 0.55;
      gl_FragColor = vec4(col, 1.0);
    }
  `
);

extend({ SurfaceMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    surfaceMaterial: import("@react-three/fiber").ThreeElement<typeof SurfaceMaterial>;
  }
}
