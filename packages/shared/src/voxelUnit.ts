import { VOXEL_UNIT } from './constants';

export { VOXEL_UNIT };

/**
 * Every visible world voxel (terrain relief, models, grass columns, water
 * droplets, props) must use this edge length on X and Z. Y may stack multiple
 * units (tall grass) but never shrink below one unit on any axis for particles.
 */
export function uniformVoxelSize(): number {
  return VOXEL_UNIT;
}

/**
 * Snap a continuous world coordinate to the nearest voxel grid index.
 * Simulation stays at full float precision; render rounds (Lego Movie water).
 * e.g. 11.4 → 11, 11.6 → 12 (with VOXEL_UNIT = 1).
 */
export function snapVoxelIndex(world: number): number {
  return Math.round(world / VOXEL_UNIT);
}

/** Snap continuous world (x,y,z) to integer voxel grid cell indices. */
export function snapVoxelCell(
  wx: number,
  wy: number,
  wz: number,
): { x: number; y: number; z: number } {
  return { x: snapVoxelIndex(wx), y: snapVoxelIndex(wy), z: snapVoxelIndex(wz) };
}

/**
 * Dominant voxel cell for particle render occupancy.
 * Picks the cell the point lies inside *more* (not nearest-round).
 * At exact mid-cell boundaries, keeps `prev` when valid to avoid flicker.
 */
export function dominantVoxelIndex(world: number, prev?: number): number {
  const scaled = world / VOXEL_UNIT;
  const lo = Math.floor(scaled);
  const frac = scaled - lo;
  if (frac > 0.5) return lo + 1;
  if (frac < 0.5) return lo;
  if (prev !== undefined && (prev === lo || prev === lo + 1)) return prev;
  return lo;
}

/** Dominant cell indices for a continuous world position. */
export function dominantVoxelCell(
  wx: number,
  wy: number,
  wz: number,
  prev?: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: dominantVoxelIndex(wx, prev?.x),
    y: dominantVoxelIndex(wy, prev?.y),
    z: dominantVoxelIndex(wz, prev?.z),
  };
}

/** Update stored render cell; returns true when the dominant cell changed. */
export function updateDominantCell(
  wx: number,
  wy: number,
  wz: number,
  render: { x: number; y: number; z: number },
): boolean {
  const next = dominantVoxelCell(wx, wy, wz, render);
  const changed = next.x !== render.x || next.y !== render.y || next.z !== render.z;
  render.x = next.x;
  render.y = next.y;
  render.z = next.z;
  return changed;
}

/** World-space center of the voxel at grid indices (gx, gy, gz). */
export function voxelGridCenter(gx: number, gy: number, gz: number): { x: number; y: number; z: number } {
  return {
    x: gx * VOXEL_UNIT + VOXEL_UNIT / 2,
    y: gy * VOXEL_UNIT + VOXEL_UNIT / 2,
    z: gz * VOXEL_UNIT + VOXEL_UNIT / 2,
  };
}

/** Scale vector for a grass column / stacked voxel column (width = 1 unit). */
export function voxelColumnScale(heightInUnits: number): { x: number; y: number; z: number } {
  return { x: VOXEL_UNIT, y: heightInUnits * VOXEL_UNIT, z: VOXEL_UNIT };
}

/**
 * Guard: world particle/instance scales must be exactly one voxel wide/tall/deep
 * unless {@link allowHeightOnly} is true (grass blades may stretch Y only).
 */
export function enforceVoxelScale(
  sx: number,
  sy: number,
  sz: number,
  allowHeightOnly = false,
): { x: number; y: number; z: number } {
  if (allowHeightOnly) {
    const x = sx !== VOXEL_UNIT ? warnClamp('x', sx, VOXEL_UNIT) : VOXEL_UNIT;
    const z = sz !== VOXEL_UNIT ? warnClamp('z', sz, VOXEL_UNIT) : VOXEL_UNIT;
    const y = sy < VOXEL_UNIT ? warnClamp('y', sy, VOXEL_UNIT) : sy;
    return { x, y, z };
  }
  const bad = sx !== VOXEL_UNIT || sy !== VOXEL_UNIT || sz !== VOXEL_UNIT;
  if (bad) {
    warnClamp('uniform', sx, VOXEL_UNIT);
    return { x: VOXEL_UNIT, y: VOXEL_UNIT, z: VOXEL_UNIT };
  }
  return { x: sx, y: sy, z: sz };
}

function warnClamp(axis: string, got: number, want: number): number {
  if (typeof console !== 'undefined') {
    console.warn(`[VoxelBound] ${axis} scale ${got} != VOXEL_UNIT (${want}); clamped.`);
  }
  return want;
}
