import * as THREE from 'three';
import { MATERIAL_COLOR, type TerrainField, tIdx } from '@voxelbound/shared';

/**
 * Greedy surface mesher for the voxel heightfield. Each chunk becomes one
 * BufferGeometry: top faces are greedy-merged across runs of equal
 * (height, material), and vertical side faces are emitted only where a column
 * steps above its neighbor (or the map border). Flat regions collapse to a few
 * big quads, so 512x512 terrain stays cheap while steps render as real 3D.
 */

const DEFAULT_CHUNK = 64;

function darken(hex: number, f: number): [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [r * f, g * f, b * f];
}

function topColor(mat: number): [number, number, number] {
  const hex = MATERIAL_COLOR[mat] ?? 0xff00ff;
  return darken(hex, 1);
}
function sideColor(mat: number): [number, number, number] {
  const hex = MATERIAL_COLOR[mat] ?? 0xff00ff;
  return darken(hex, 0.72);
}

interface Buffers {
  pos: number[];
  norm: number[];
  col: number[];
}

function quad(
  b: Buffers,
  a: [number, number, number],
  bb: [number, number, number],
  c: [number, number, number],
  dd: [number, number, number],
  n: [number, number, number],
  color: [number, number, number],
): void {
  const verts = [a, bb, c, a, c, dd];
  for (const v of verts) {
    b.pos.push(v[0], v[1], v[2]);
    b.norm.push(n[0], n[1], n[2]);
    b.col.push(color[0], color[1], color[2]);
  }
}

function buildChunk(field: TerrainField, x0: number, z0: number, cs: number, floorY: number): THREE.BufferGeometry | null {
  const { w, d, height, material } = field;
  const cw = Math.min(cs, w - x0);
  const cd = Math.min(cs, d - z0);
  if (cw <= 0 || cd <= 0) return null;

  const b: Buffers = { pos: [], norm: [], col: [] };
  const visited = new Uint8Array(cw * cd);

  // -- greedy top faces --
  for (let lz = 0; lz < cd; lz++) {
    for (let lx = 0; lx < cw; lx++) {
      const li = lz * cw + lx;
      if (visited[li]) continue;
      const gi = tIdx(x0 + lx, z0 + lz, w);
      const h = height[gi]!;
      const mat = material[gi]!;

      // extend width
      let wq = 1;
      while (lx + wq < cw) {
        const ni = tIdx(x0 + lx + wq, z0 + lz, w);
        if (visited[lz * cw + lx + wq] || height[ni] !== h || material[ni] !== mat) break;
        wq++;
      }
      // extend depth
      let hq = 1;
      outer: while (lz + hq < cd) {
        for (let k = 0; k < wq; k++) {
          const ni = tIdx(x0 + lx + k, z0 + lz + hq, w);
          if (visited[(lz + hq) * cw + lx + k] || height[ni] !== h || material[ni] !== mat) break outer;
        }
        hq++;
      }
      for (let dz = 0; dz < hq; dz++) for (let dx = 0; dx < wq; dx++) visited[(lz + dz) * cw + lx + dx] = 1;

      const gx = x0 + lx;
      const gz = z0 + lz;
      const y = h;
      quad(
        b,
        [gx, y, gz],
        [gx, y, gz + hq],
        [gx + wq, y, gz + hq],
        [gx + wq, y, gz],
        [0, 1, 0],
        topColor(mat),
      );
    }
  }

  // -- side faces at steps (per column; only flat core has none) --
  const sideAt = (gx: number, gz: number): number => {
    if (gx < 0 || gz < 0 || gx >= w || gz >= d) return floorY;
    return height[tIdx(gx, gz, w)]!;
  };
  for (let lz = 0; lz < cd; lz++) {
    for (let lx = 0; lx < cw; lx++) {
      const gx = x0 + lx;
      const gz = z0 + lz;
      const gi = tIdx(gx, gz, w);
      const h = height[gi]!;
      const col = sideColor(material[gi]!);

      // +x edge
      let nh = sideAt(gx + 1, gz);
      if (nh < h) quad(b, [gx + 1, h, gz], [gx + 1, h, gz + 1], [gx + 1, nh, gz + 1], [gx + 1, nh, gz], [1, 0, 0], col);
      // -x edge
      nh = sideAt(gx - 1, gz);
      if (nh < h) quad(b, [gx, h, gz + 1], [gx, h, gz], [gx, nh, gz], [gx, nh, gz + 1], [-1, 0, 0], col);
      // +z edge
      nh = sideAt(gx, gz + 1);
      if (nh < h) quad(b, [gx + 1, h, gz + 1], [gx, h, gz + 1], [gx, nh, gz + 1], [gx + 1, nh, gz + 1], [0, 0, 1], col);
      // -z edge
      nh = sideAt(gx, gz - 1);
      if (nh < h) quad(b, [gx, h, gz], [gx + 1, h, gz], [gx + 1, nh, gz], [gx, nh, gz], [0, 0, -1], col);
    }
  }

  if (b.pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  return geo;
}

/** Lowest skirt floor for side faces. */
export function terrainFloorY(field: TerrainField): number {
  let minH = Infinity;
  for (let i = 0; i < field.height.length; i++) if (field.height[i]! < minH) minH = field.height[i]!;
  return minH - 2;
}

/** Build a single terrain chunk mesh (lazy streaming). */
export function buildTerrainChunkMesh(
  field: TerrainField,
  chunkX: number,
  chunkZ: number,
  chunkSize = DEFAULT_CHUNK,
  floorY?: number,
): THREE.Mesh | null {
  const x0 = chunkX * chunkSize;
  const z0 = chunkZ * chunkSize;
  if (x0 >= field.w || z0 >= field.d) return null;
  const fy = floorY ?? terrainFloorY(field);
  const geo = buildChunk(field, x0, z0, chunkSize, fy);
  if (!geo) return null;
  geo.computeBoundingBox();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = true;
  mesh.userData.chunkX = chunkX;
  mesh.userData.chunkZ = chunkZ;
  return mesh;
}

/** Build one mesh per chunk for the whole terrain field. */
export function buildTerrainMeshes(field: TerrainField, chunkSize = DEFAULT_CHUNK): THREE.Mesh[] {
  const floorY = terrainFloorY(field);

  const meshes: THREE.Mesh[] = [];
  for (let z0 = 0; z0 < field.d; z0 += chunkSize) {
    for (let x0 = 0; x0 < field.w; x0 += chunkSize) {
      const mesh = buildTerrainChunkMesh(field, x0 / chunkSize, z0 / chunkSize, chunkSize, floorY);
      if (mesh) meshes.push(mesh);
    }
  }
  return meshes;
}
