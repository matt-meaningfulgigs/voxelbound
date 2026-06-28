import * as THREE from 'three';
import {
  heightAt,
  hashSeed,
  valueNoise2D,
  TerrainMaterial,
  VOXEL_UNIT,
  enforceVoxelScale,
  type SurfaceCover,
  type TerrainField,
  tIdx,
} from '@voxelbound/shared';
import { unitVoxelGeometryBasePivot } from './voxelGeometry';

const CHUNK = 64;

export type GrassStyle = 'flat' | 'shortTuft' | 'wild';

export interface GrassLayerOptions {
  /** Town center for flat mowed grass. */
  townCenterX?: number;
  townCenterZ?: number;
  /** Radius in world units where town grass rules apply. */
  townRadius?: number;
}

/**
 * Full-map grass cover split into spatial chunks so each piece can be
 * frustum-culled. One chunky voxel column per grassy terrain cell.
 */
export class GrassLayer {
  readonly root = new THREE.Group();
  private field: TerrainField;
  private cover: SurfaceCover;
  private seed: number;
  private townCx: number;
  private townCz: number;
  private townR: number;
  private chunkMeshes: THREE.InstancedMesh[] = [];
  private chunkKeys: string[] = [];
  /** terrain cell index -> chunk mesh index (-1 if not grassy). */
  private cellToChunk: Int16Array;
  /** terrain cell index -> instance index within that chunk. */
  private cellToLocal: Int32Array;
  private dummy = new THREE.Object3D();
  private colorStanding = new THREE.Color(0x6bb33f);
  private colorTrampled = new THREE.Color(0x8aa84a);
  private colorWild = new THREE.Color(0x5a9a38);

  constructor(scene: THREE.Scene, field: TerrainField, cover: SurfaceCover, seed = 1, opts: GrassLayerOptions = {}) {
    this.field = field;
    this.cover = cover;
    this.seed = seed;
    this.townCx = opts.townCenterX ?? field.w * 0.5;
    this.townCz = opts.townCenterZ ?? field.d * 0.5;
    this.townR = opts.townRadius ?? 110;
    const n = field.w * field.d;
    this.cellToChunk = new Int16Array(n).fill(-1);
    this.cellToLocal = new Int32Array(n).fill(-1);

    const buckets = new Map<number, number[]>();
    for (let z = 0; z < field.d; z++) {
      for (let x = 0; x < field.w; x++) {
        const i = tIdx(x, z, field.w);
        if (!cover.eligible[i]) continue;
        const key = (Math.floor(x / CHUNK) << 16) | Math.floor(z / CHUNK);
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(i);
      }
    }

    const geo = unitVoxelGeometryBasePivot();
    for (const [key, cells] of buckets) {
      const cx = (key >> 16) & 0xffff;
      const cz = key & 0xffff;
      const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = true;
      const chunkIdx = this.chunkMeshes.length;
      this.chunkKeys.push(`${cx},${cz}`);
      cells.forEach((cell, local) => {
        this.cellToChunk[cell] = chunkIdx;
        this.cellToLocal[cell] = local;
        const x = cell % field.w;
        const z = (cell / field.w) | 0;
        this.writeInstance(mesh, local, x, z, cell);
      });
      mesh.count = cells.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const x0 = cx * CHUNK;
      const z0 = cz * CHUNK;
      const x1 = Math.min(field.w, x0 + CHUNK);
      const z1 = Math.min(field.d, z0 + CHUNK);
      const sphere = new THREE.Sphere();
      sphere.center.set((x0 + x1) * 0.5, 8, (z0 + z1) * 0.5);
      sphere.radius = Math.hypot(x1 - x0, z1 - z0) * 0.75 + 12;
      mesh.boundingSphere = sphere;
      this.chunkMeshes.push(mesh);
      this.root.add(mesh);
    }

    scene.add(this.root);
    cover.clearDirty();
  }

  /** Refresh any cells whose cover state changed (trampled / regrown). */
  update(): void {
    const dirty = this.cover.takeDirtyCells();
    if (dirty.length === 0) return;
    const touched = new Set<number>();
    for (const i of dirty) {
      const chunkIdx = this.cellToChunk[i]!;
      if (chunkIdx < 0) continue;
      const local = this.cellToLocal[i]!;
      const x = i % this.field.w;
      const z = (i / this.field.w) | 0;
      this.writeInstance(this.chunkMeshes[chunkIdx]!, local, x, z, i);
      touched.add(chunkIdx);
    }
    for (const ci of touched) {
      const mesh = this.chunkMeshes[ci]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Instanced meshes and chunk coordinate keys for {@link ChunkRuntime}. */
  getChunkBindings(): { meshes: THREE.InstancedMesh[]; keys: string[] } {
    return { meshes: this.chunkMeshes, keys: this.chunkKeys };
  }

  private grassStyle(x: number, z: number): GrassStyle {
    const dx = x - this.townCx;
    const dz = z - this.townCz;
    if (dx * dx + dz * dz > this.townR * this.townR) return 'wild';
    const tuftNoise = valueNoise2D(x * 0.08, z * 0.08, this.seed + 0x7ea5);
    if (tuftNoise > 0.82) return 'shortTuft';
    return 'flat';
  }

  private bladeHeight(x: number, z: number, material: number, style: GrassStyle): number {
    const micro = ((hashSeed(x, z, this.seed) >> 12) & 0xff) / 255;
    if (style === 'flat') return 0.35 + micro * 0.2;
    if (style === 'shortTuft') return 0.75 + micro * 0.45;
    const wild = valueNoise2D(x * 0.045, z * 0.045, this.seed + 0x51ea);
    const isDark = material === TerrainMaterial.DarkGrass;
    if (wild > 0.58 || isDark) {
      return 2.2 + micro * 1.6 + (isDark ? 0.4 : 0);
    }
    if (wild > 0.38) {
      return 1.4 + micro * 0.9;
    }
    return 0.9 + micro * 0.5;
  }

  private writeInstance(
    mesh: THREE.InstancedMesh,
    n: number,
    x: number,
    z: number,
    cell: number,
  ): void {
    const { field, cover } = this;
    const h = hashSeed(x, z, this.seed);
    const jx = ((h & 0xff) / 255 - 0.5) * 0.12;
    const jz = (((h >> 8) & 0xff) / 255 - 0.5) * 0.12;
    const scaleY = this.bladeHeight(x, z, field.material[cell]!, this.grassStyle(x, z));

    const wx = x + 0.5 + jx;
    const wz = z + 0.5 + jz;
    const y = heightAt(field, x, z);

    const d = this.dummy;
    d.position.set(wx, y, wz);
    d.rotation.set(0, 0, 0);
    const scale = enforceVoxelScale(VOXEL_UNIT, scaleY * VOXEL_UNIT, VOXEL_UNIT, true);
    d.scale.set(scale.x, scale.y, scale.z);

    const st = cover.state[cell]!;
    if (st !== 0) {
      const facing = st - 1;
      const tip = Math.PI * 0.42;
      if (facing === 0) d.rotation.x = -tip;
      else if (facing === 2) d.rotation.x = tip;
      else if (facing === 1) d.rotation.z = -tip;
      else d.rotation.z = tip;
    }
    d.updateMatrix();
    mesh.setMatrixAt(n, d.matrix);

    const wild = field.material[cell] === TerrainMaterial.DarkGrass;
    const col = st !== 0 ? this.colorTrampled : wild ? this.colorWild : this.colorStanding;
    mesh.setColorAt(n, col);
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    let geoDisposed = false;
    for (const mesh of this.chunkMeshes) {
      if (!geoDisposed) {
        mesh.geometry.dispose();
        geoDisposed = true;
      }
      (mesh.material as THREE.Material).dispose();
    }
    this.chunkMeshes = [];
  }
}
