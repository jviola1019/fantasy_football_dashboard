"use client";

/**
 * Four-point studio light rig tuned for the RAE neon palette. The dedicated
 * back-light is what makes scene objects separate crisply from the near-black
 * panel background — the "backlighting" the blueprint relies on.
 *
 *   - Key  : cool cyan-blue from upper-right (the brightest front source).
 *   - Fill : warm amber from lower-left (softens the shadows).
 *   - Back : bright cyan placed *behind* the objects (high negative-Z) and
 *            aimed at the camera, so every silhouette catches a glowing rim.
 *   - Rim  : magenta point light that bleeds into bloom for the neon halo.
 *
 * Plus a low ambient so deep shadows don't crush to black on cheaper GPUs.
 */
export function StudioLighting() {
  return (
    <>
      <ambientLight intensity={0.4} color="#dfeaf3" />
      <directionalLight position={[6, 6, 5]} intensity={1.05} color="#9ad0ff" />
      <directionalLight position={[-6, -2, 3]} intensity={0.45} color="#ffb27a" />
      {/* Back-light: high negative-Z, aimed through the scene at the camera. */}
      <directionalLight position={[0, 3, -9]} intensity={1.7} color="#bfe6ff" />
      {/* Magenta neon rim that feeds bloom for the silhouette halo. */}
      <pointLight position={[0, 4, -4]} intensity={1.15} color="#f0abfc" distance={24} decay={2} />
    </>
  );
}
