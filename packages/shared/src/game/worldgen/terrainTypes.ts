// ---------------------------------------------------------------------------
// Terrain data model. A voxel-heightfield world: per-column surface height,
// surface material, and a baked walkable mask used for 2D collision.
// Rendering (chunk meshing) and the fluid sim consume these fields.
// ---------------------------------------------------------------------------

export const TerrainMaterial = {
  Grass: 0,
  Dirt: 1,
  Rock: 2,
  Sand: 3,
  Stone: 4,
  Path: 5,
  Plaza: 6,
  DarkGrass: 7,
} as const;

export type TerrainMaterialId = (typeof TerrainMaterial)[keyof typeof TerrainMaterial];

/** Base top-face colors per material (sides are darkened from these). */
export const MATERIAL_COLOR: Record<number, number> = {
  [TerrainMaterial.Grass]: 0x5a8f3c,
  [TerrainMaterial.Dirt]: 0x8a6a43,
  [TerrainMaterial.Rock]: 0x7d7468,
  [TerrainMaterial.Sand]: 0xd8c98f,
  [TerrainMaterial.Stone]: 0xa9a294,
  [TerrainMaterial.Path]: 0xc2a06e,
  [TerrainMaterial.Plaza]: 0xbcb39b,
  [TerrainMaterial.DarkGrass]: 0x4f8434,
};

/** Which materials should grow grass-cover blades (Phase 3/3b). */
export const GRASSY_MATERIALS = new Set<number>([TerrainMaterial.Grass, TerrainMaterial.DarkGrass]);

export interface TerrainField {
  /** Width / depth in columns (world units, 1 column = 1 unit). */
  w: number;
  d: number;
  /** Surface height per column (world units). length = w*d, row-major (z*w + x). */
  height: Float32Array;
  /** Surface material id per column. length = w*d. */
  material: Uint8Array;
  /** 1 = walkable, 0 = blocked. length = w*d. */
  walkable: Uint8Array;
}

export interface OverworldDef {
  seed: number;
  w: number;
  d: number;
  /** Global sea level; columns below this fill with water. */
  seaLevel: number;
  /** Vertical scale of terrain relief in world units. */
  reliefScale: number;
  /** Base height of the walkable town core. */
  coreLevel: number;
}

export const DEFAULT_OVERWORLD: OverworldDef = {
  seed: 1,
  w: 512,
  d: 512,
  seaLevel: 1.5,
  reliefScale: 26,
  coreLevel: 4,
};

export function tIdx(x: number, z: number, w: number): number {
  return z * w + x;
}

export function inField(field: TerrainField, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < field.w && z < field.d;
}

/** Nearest-column height (cheap; fine for placement). */
export function heightAt(field: TerrainField, x: number, z: number): number {
  const ix = Math.max(0, Math.min(field.w - 1, Math.round(x)));
  const iz = Math.max(0, Math.min(field.d - 1, Math.round(z)));
  return field.height[tIdx(ix, iz, field.w)]!;
}

/** Bilinear-sampled height (smooth; for cameras/actors riding the surface). */
export function heightBilinear(field: TerrainField, x: number, z: number): number {
  const w = field.w;
  const d = field.d;
  const cx = Math.max(0, Math.min(w - 1.001, x));
  const cz = Math.max(0, Math.min(d - 1.001, z));
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fz = cz - z0;
  const h = field.height;
  const h00 = h[tIdx(x0, z0, w)]!;
  const h10 = h[tIdx(x0 + 1, z0, w)]!;
  const h01 = h[tIdx(x0, z0 + 1, w)]!;
  const h11 = h[tIdx(x0 + 1, z0 + 1, w)]!;
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

export function walkableAt(field: TerrainField, x: number, z: number): boolean {
  const ix = Math.round(x);
  const iz = Math.round(z);
  if (ix < 0 || iz < 0 || ix >= field.w || iz >= field.d) return false;
  return field.walkable[tIdx(ix, iz, field.w)] === 1;
}
