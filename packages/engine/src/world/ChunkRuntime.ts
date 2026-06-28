import * as THREE from 'three';
import type { TerrainField } from '@voxelbound/shared';
import { buildTerrainChunkMesh, terrainFloorY } from '../render/ChunkMesher';

/** Runtime chunk size for visibility / simulation ownership. */
export const RUNTIME_CHUNK_SIZE = 32;
/** Terrain mesh chunk size (one mesh chunk spans 2×2 runtime chunks at 64). */
export const TERRAIN_MESH_CHUNK = 64;
const PRELOAD_CHUNKS = 1;
const MAX_REBUILDS_PER_FRAME = 4;

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function meshChunkKey(meshCx: number, meshCz: number): string {
  return `${meshCx},${meshCz}`;
}

export interface ChunkRuntimeStats {
  visibleTerrain: number;
  simTerrain: number;
  activeProps: number;
  dirtyQueued: number;
}

/**
 * Owns terrain streaming, prop chunk registration, and visibility rings.
 * Visible ring = render; sim ring = visible + preload margin for effects.
 */
export class ChunkRuntime {
  private scene: THREE.Scene;
  private field: TerrainField;
  private floorY: number;

  private terrainMeshes = new Map<string, THREE.Mesh>();
  private visibleTerrain = new Set<string>();
  private simTerrain = new Set<string>();

  private propsByChunk = new Map<string, THREE.Object3D[]>();
  private grassMeshes: THREE.InstancedMesh[] = [];
  private grassChunkKeys: string[] = [];

  private viewX = 0;
  private viewZ = 0;
  private viewR = 120;
  private dirty = new Set<string>();

  readonly stats: ChunkRuntimeStats = {
    visibleTerrain: 0,
    simTerrain: 0,
    activeProps: 0,
    dirtyQueued: 0,
  };

  constructor(scene: THREE.Scene, field: TerrainField) {
    this.scene = scene;
    this.field = field;
    this.floorY = terrainFloorY(field);
  }

  /** Link grass layer chunk meshes for visibility toggling. */
  bindGrass(meshes: THREE.InstancedMesh[], chunkKeys: string[]): void {
    this.grassMeshes = meshes;
    this.grassChunkKeys = chunkKeys;
  }

  registerProp(obj: THREE.Object3D, worldX: number, worldZ: number): void {
    const cx = Math.floor(worldX / RUNTIME_CHUNK_SIZE);
    const cz = Math.floor(worldZ / RUNTIME_CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    let list = this.propsByChunk.get(key);
    if (!list) {
      list = [];
      this.propsByChunk.set(key, list);
    }
    list.push(obj);
    obj.userData.chunkKey = key;
  }

  markDirty(worldX: number, worldZ: number): void {
    const cx = Math.floor(worldX / RUNTIME_CHUNK_SIZE);
    const cz = Math.floor(worldZ / RUNTIME_CHUNK_SIZE);
    this.dirty.add(chunkKey(cx, cz));
    this.stats.dirtyQueued = this.dirty.size;
  }

  updateView(viewX: number, viewZ: number, viewRadius: number): void {
    this.viewX = viewX;
    this.viewZ = viewZ;
    this.viewR = Math.max(32, viewRadius);

    const simR = this.viewR + RUNTIME_CHUNK_SIZE * (PRELOAD_CHUNKS + 1);
    const visR = this.viewR + RUNTIME_CHUNK_SIZE * 0.5;

    const nextVisible = new Set<string>();
    const nextSim = new Set<string>();

    const minCx = Math.floor((viewX - simR) / RUNTIME_CHUNK_SIZE);
    const maxCx = Math.floor((viewX + simR) / RUNTIME_CHUNK_SIZE);
    const minCz = Math.floor((viewZ - simR) / RUNTIME_CHUNK_SIZE);
    const maxCz = Math.floor((viewZ + simR) / RUNTIME_CHUNK_SIZE);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = chunkKey(cx, cz);
        nextSim.add(key);
        const cxWorld = cx * RUNTIME_CHUNK_SIZE + RUNTIME_CHUNK_SIZE / 2;
        const czWorld = cz * RUNTIME_CHUNK_SIZE + RUNTIME_CHUNK_SIZE / 2;
        const dx = cxWorld - viewX;
        const dz = czWorld - viewZ;
        if (dx * dx + dz * dz <= visR * visR) nextVisible.add(key);
      }
    }

    for (const key of this.terrainMeshes.keys()) {
      const mesh = this.terrainMeshes.get(key)!;
      const meshCx = mesh.userData.chunkX as number;
      const meshCz = mesh.userData.chunkZ as number;
      const rcx = Math.floor((meshCx * TERRAIN_MESH_CHUNK) / RUNTIME_CHUNK_SIZE);
      const rcz = Math.floor((meshCz * TERRAIN_MESH_CHUNK) / RUNTIME_CHUNK_SIZE);
      let inSim = false;
      for (let dz = 0; dz <= 1 && !inSim; dz++)
        for (let dx = 0; dx <= 1; dx++)
          if (nextSim.has(chunkKey(rcx + dx, rcz + dz))) inSim = true;
      if (inSim) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.terrainMeshes.delete(key);
    }

    let rebuilt = 0;
    const neededMeshKeys = new Set<string>();
    for (const key of nextSim) {
      const [rcx, rcz] = key.split(',').map(Number) as [number, number];
      const meshCx = Math.floor((rcx * RUNTIME_CHUNK_SIZE) / TERRAIN_MESH_CHUNK);
      const meshCz = Math.floor((rcz * RUNTIME_CHUNK_SIZE) / TERRAIN_MESH_CHUNK);
      neededMeshKeys.add(meshChunkKey(meshCx, meshCz));
    }

    for (const meshKey of neededMeshKeys) {
      if (this.terrainMeshes.has(meshKey)) continue;
      if (rebuilt >= MAX_REBUILDS_PER_FRAME) continue;
      const [meshCx, meshCz] = meshKey.split(',').map(Number) as [number, number];
      const mesh = buildTerrainChunkMesh(this.field, meshCx, meshCz, TERRAIN_MESH_CHUNK, this.floorY);
      if (!mesh) continue;
      this.scene.add(mesh);
      this.terrainMeshes.set(meshKey, mesh);
      rebuilt++;
    }

    for (const dk of this.dirty) {
      if (rebuilt >= MAX_REBUILDS_PER_FRAME) break;
      this.dirty.delete(dk);
    }

    let activeProps = 0;
    for (const [key, list] of this.propsByChunk) {
      const vis = nextVisible.has(key);
      for (const obj of list) {
        obj.visible = vis;
        if (vis) activeProps++;
      }
    }

    for (let i = 0; i < this.grassMeshes.length; i++) {
      const gkey = this.grassChunkKeys[i];
      if (!gkey) continue;
      const [gcx, gcz] = gkey.split(',').map(Number) as [number, number];
      const rcx = Math.floor((gcx * TERRAIN_MESH_CHUNK) / RUNTIME_CHUNK_SIZE);
      const rcz = Math.floor((gcz * TERRAIN_MESH_CHUNK) / RUNTIME_CHUNK_SIZE);
      let vis = false;
      for (let dz = 0; dz <= 1 && !vis; dz++)
        for (let dx = 0; dx <= 1; dx++)
          if (nextVisible.has(chunkKey(rcx + dx, rcz + dz))) vis = true;
      this.grassMeshes[i]!.visible = vis;
    }

    this.visibleTerrain = nextVisible;
    this.simTerrain = nextSim;
    this.stats.visibleTerrain = nextVisible.size;
    this.stats.simTerrain = nextSim.size;
    this.stats.activeProps = activeProps;
    this.stats.dirtyQueued = this.dirty.size;
  }

  dispose(): void {
    for (const mesh of this.terrainMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.terrainMeshes.clear();
    this.propsByChunk.clear();
  }
}
