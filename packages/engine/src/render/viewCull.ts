import type { CameraConfig } from '@voxelbound/shared';

/**
 * Conservative ground-plane radius visible from the orthographic isometric camera.
 * Used to skip sim/render for off-screen water, props, and grass chunks.
 */
export function computeViewCullRadius(
  cfg: CameraConfig,
  aspect: number,
  margin = 1.02,
): number {
  const halfH = cfg.viewHeightVoxels * cfg.zoom * 0.5;
  const halfW = halfH * aspect;
  const pitch = (cfg.pitchDeg * Math.PI) / 180;
  const sinP = Math.max(0.35, Math.sin(pitch));
  return (Math.hypot(halfW, halfH) / sinP) * margin;
}

export function isInsideViewCull(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radius: number,
): boolean {
  const dx = x - centerX;
  const dz = z - centerZ;
  return dx * dx + dz * dz <= radius * radius;
}
