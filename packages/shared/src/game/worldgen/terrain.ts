// ---------------------------------------------------------------------------
// Procedural terrain generation. Produces an integer-stepped voxel heightfield
// (so the world reads as chunky voxel relief with real 3D steps), a surface
// material per column, and a baked walkable mask for 2D collision.
//
// The town core is deliberately flat at `coreLevel` so gameplay stays "at
// level"; relief, lakes, ocean and rock outcrops live outside the core.
// ---------------------------------------------------------------------------

import { fbm2D, hashSeed, ridge2D, valueNoise2D } from './noise';
import {
  type OverworldDef,
  type TerrainField,
  TerrainMaterial,
  tIdx,
} from './terrainTypes';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function generateTerrain(def: OverworldDef): TerrainField {
  const { seed, w, d, seaLevel, reliefScale, coreLevel } = def;
  const height = new Float32Array(w * d);
  const material = new Uint8Array(w * d);
  const walkable = new Uint8Array(w * d);

  const cx = w / 2;
  const cz = d / 2;
  const coreR = Math.min(w, d) * 0.34; // flat town radius

  // A lake roughly where the old pond was (~0.25w, 0.8d).
  const lakeX = w * 0.25;
  const lakeZ = d * 0.8;
  const lakeR = Math.min(w, d) * 0.13;

  // -- pass 1: heights --
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = tIdx(x, z, w);

      // rolling hills
      const n = fbm2D(x * 0.012, z * 0.012, seed, { octaves: 4 });
      let h = (n - 0.5) * 2 * reliefScale;

      // flatten the town core toward coreLevel
      const dc = Math.hypot(x - cx, z - cz) / coreR;
      const coreT = smoothstep(0.7, 1.25, dc); // 0 inside core, 1 outside
      h = lerp(coreLevel, coreLevel + h, coreT);

      // ocean ramp near the map borders
      const bx = Math.min(x, w - 1 - x) / (w * 0.5);
      const bz = Math.min(z, d - 1 - z) / (d * 0.5);
      const borderT = smoothstep(0.18, 0.04, Math.min(bx, bz)); // ->1 at the edge
      h = lerp(h, seaLevel - 6, borderT);

      // lake basin
      const dl = Math.hypot(x - lakeX, z - lakeZ) / lakeR;
      if (dl < 1.4) {
        const lakeT = smoothstep(1.4, 0.45, dl);
        h = lerp(h, seaLevel - 4, lakeT);
      }

      // rock outcrops out in the hills
      const r = ridge2D(x * 0.02, z * 0.02, hashSeed(seed, 99), { octaves: 3 });
      if (r > 0.82 && coreT > 0.6) h += (r - 0.82) * reliefScale * 2.2;

      height[i] = Math.round(h);
    }
  }

  // -- pass 2: materials + walkable (needs neighbor heights for slope) --
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = tIdx(x, z, w);
      const h = height[i]!;

      let maxd = 0;
      if (x > 0) maxd = Math.max(maxd, Math.abs(h - height[i - 1]!));
      if (x < w - 1) maxd = Math.max(maxd, Math.abs(h - height[i + 1]!));
      if (z > 0) maxd = Math.max(maxd, Math.abs(h - height[i - w]!));
      if (z < d - 1) maxd = Math.max(maxd, Math.abs(h - height[i + w]!));

      let mat: number;
      if (h < seaLevel + 1.2) {
        mat = TerrainMaterial.Sand; // beach band around water
      } else if (maxd >= 3 || h > coreLevel + 16) {
        mat = TerrainMaterial.Rock;
      } else {
        const g = valueNoise2D(x * 0.05, z * 0.05, hashSeed(seed, 7));
        mat = g < 0.42 ? TerrainMaterial.DarkGrass : TerrainMaterial.Grass;
      }
      material[i] = mat;

      // Allow a shallow "wading" band just below the waterline so the player
      // can step into the surf/lake edge (deeper water stays blocked).
      const border = x < 6 || z < 6 || x >= w - 6 || z >= d - 6;
      walkable[i] = !border && h >= seaLevel - 1.2 && maxd < 3 ? 1 : 0;
    }
  }

  return { w, d, height, material, walkable };
}
