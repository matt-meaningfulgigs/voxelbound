import * as THREE from 'three';
import {
  VOXEL_UNIT,
  enforceVoxelScale,
  updateDominantCell,
  type EmitterVoxel,
  type VoxelModel,
  worldEmittersFromPlacement,
} from '@voxelbound/shared';
import { unitVoxelGeometry, voxelCenter } from '../render/voxelGeometry';

/**
 * Voxel-snapped fire + billowing smoke driven by model palette emitters.
 * Float physics, dominant-cell render occupancy, one supervoxel per cluster.
 */

const FIRE_PARTICLE_CAP = 8192;
const SMOKE_PARTICLE_CAP = 8192;
const FIRE_RENDER_CAP = 4096;
const SMOKE_RENDER_CAP = 4096;
const FIRE_CLUSTER_R = 2;
const SMOKE_CLUSTER_R = 2;
const EMIT_BUDGET = 96;
const CULL_MARGIN = 1.1;
const RUNTIME_CHUNK = 32;
const HEAT_SMOKE_THRESHOLD = 0.32;

const COLOR_FIRE_A = new THREE.Color(1.0, 0.38, 0.04);
const COLOR_FIRE_B = new THREE.Color(1.0, 0.82, 0.14);
const COLOR_FIRE_C = new THREE.Color(0.95, 0.12, 0.02);
const COLOR_SMOKE_DARK = new THREE.Color(0.32, 0.32, 0.36);
const COLOR_SMOKE_LIGHT = new THREE.Color(0.72, 0.72, 0.76);

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  intensity: number;
  /** 1 near source, decays with age/height — drives fire-to-smoke transition. */
  heat: number;
  /** When heat drops, particle renders as smoke while still in the fire pool. */
  asSmoke: boolean;
  render: { x: number; y: number; z: number };
  sourceY: number;
}

export interface VisualCell {
  gx: number;
  gy: number;
  gz: number;
  weight: number;
  ageSum: number;
  heatSum: number;
  billow: boolean;
  clusterMass: number;
}

interface EmitterRegion {
  x: number;
  y: number;
  z: number;
  kind: 'fire' | 'smoke';
  strength: number;
  chunkKey: string;
  sourceCount: number;
}

function cellKey(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}

function runtimeChunkKey(x: number, z: number): string {
  return `${Math.floor(x / RUNTIME_CHUNK)},${Math.floor(z / RUNTIME_CHUNK)}`;
}

function clusterOffsets(clusterR: number): Array<[number, number, number]> {
  const offsets: Array<[number, number, number]> = [];
  for (let dx = -clusterR; dx <= clusterR; dx++)
    for (let dy = -clusterR; dy <= clusterR; dy++)
      for (let dz = -clusterR; dz <= clusterR; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= clusterR) offsets.push([dx, dy, dz]);
      }
  return offsets;
}

function classifyClusters3D(
  cells: Map<string, VisualCell>,
  clusterR: number,
  billowMinCells: number,
  billowMinWeight: number,
): void {
  const visited = new Set<string>();
  const offsets = clusterOffsets(clusterR);

  for (const startKey of cells.keys()) {
    if (visited.has(startKey)) continue;
    const cluster: VisualCell[] = [];
    const queue = [startKey];
    visited.add(startKey);

    while (queue.length) {
      const key = queue.pop()!;
      const c = cells.get(key)!;
      cluster.push(c);
      for (const [dx, dy, dz] of offsets) {
        const nk = cellKey(c.gx + dx, c.gy + dy, c.gz + dz);
        if (!cells.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        queue.push(nk);
      }
    }

    const total = cluster.reduce((n, c) => n + c.weight, 0);
    const mass = cluster.length + total * 0.65;
    const billow = cluster.length >= billowMinCells || total >= billowMinWeight;
    for (const c of cluster) {
      c.billow = billow;
      c.clusterMass = mass;
    }
  }
}

export function classifySmokeBillows(cells: Map<string, VisualCell>, clusterR = SMOKE_CLUSTER_R): void {
  classifyClusters3D(cells, clusterR, 2, 1.8);
}

export function classifyFireClusters(cells: Map<string, VisualCell>, clusterR = FIRE_CLUSTER_R): void {
  classifyClusters3D(cells, clusterR, 2, 1.5);
}

export function fireClusterScale(mass: number, weight: number): number {
  return 0.85 + Math.min(3.2, Math.sqrt(mass) * 0.52 + (weight - 1) * 0.08);
}

/** Aggregate adjacent fire emitter voxels into regions (eliminates O(n²) neighbor scans). */
export function buildEmitterRegions(sources: EmitterVoxel[]): EmitterRegion[] {
  const fire = sources.filter((s) => s.kind === 'fire' || s.kind === 'smoke');
  if (!fire.length) return [];

  const byKey = new Map<string, EmitterVoxel[]>();
  for (const s of fire) {
    const k = cellKey(Math.round(s.x), Math.round(s.y), Math.round(s.z));
    const list = byKey.get(k);
    if (list) list.push(s);
    else byKey.set(k, [s]);
  }

  const visited = new Set<string>();
  const faceNeighbors: ReadonlyArray<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const regions: EmitterRegion[] = [];

  for (const startKey of byKey.keys()) {
    if (visited.has(startKey)) continue;
    const cluster: EmitterVoxel[] = [];
    const queue = [startKey];
    visited.add(startKey);

    while (queue.length) {
      const key = queue.pop()!;
      const list = byKey.get(key)!;
      cluster.push(...list);
      const [gx, gy, gz] = key.split(',').map(Number) as [number, number, number];
      for (const [dx, dy, dz] of faceNeighbors) {
        const nk = cellKey(gx + dx, gy + dy, gz + dz);
        if (!byKey.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        queue.push(nk);
      }
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;
    let smoke = 0;
    for (const s of cluster) {
      sx += s.x;
      sy += s.y;
      sz += s.z;
      if (s.kind === 'smoke') smoke++;
    }
    const n = cluster.length;
    const kind = smoke > n / 2 ? 'smoke' : 'fire';
    const strength = Math.min(1, n / 6);
    regions.push({
      x: sx / n,
      y: sy / n,
      z: sz / n,
      kind,
      strength,
      chunkKey: runtimeChunkKey(sx / n, sz / n),
      sourceCount: n,
    });
  }
  return regions;
}

export class EmitterEffects {
  private scene: THREE.Scene;
  private fireMesh: THREE.InstancedMesh;
  private smokeMesh: THREE.InstancedMesh;
  private fireParts: Particle[] = [];
  private smokeParts: Particle[] = [];
  private fireNext = 0;
  private smokeNext = 0;
  private sources: EmitterVoxel[] = [];
  private regions: EmitterRegion[] = [];
  private fireAcc = 0;
  private emitStride = 0;
  private viewCullR = 120;
  private viewX = 0;
  private viewZ = 0;
  private simChunks = new Set<string>();

  private dummy = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();
  private fireScratch = new Map<string, VisualCell>();
  private smokeScratch = new Map<string, VisualCell>();

  /** Debug counters for overlay / tests. */
  readonly stats = {
    activeFire: 0,
    activeSmoke: 0,
    fireInstances: 0,
    smokeInstances: 0,
    activeRegions: 0,
    simChunks: 0,
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const geo = unitVoxelGeometry();

    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    });
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });

    this.fireMesh = new THREE.InstancedMesh(geo, fireMat, FIRE_RENDER_CAP);
    this.smokeMesh = new THREE.InstancedMesh(geo, smokeMat, SMOKE_RENDER_CAP);
    for (const mesh of [this.fireMesh, this.smokeMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(mesh.count * 3).fill(1),
        3,
      );
      mesh.frustumCulled = true;
      mesh.count = 0;
      this.scene.add(mesh);
    }
    this.fireMesh.renderOrder = 5;
    this.smokeMesh.renderOrder = 6;

    for (let i = 0; i < FIRE_PARTICLE_CAP; i++) {
      this.fireParts.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, intensity: 0.5, heat: 1, asSmoke: false,
        render: { x: 0, y: 0, z: 0 }, sourceY: 0,
      });
    }
    for (let i = 0; i < SMOKE_PARTICLE_CAP; i++) {
      this.smokeParts.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, intensity: 0.5, heat: 0, asSmoke: true,
        render: { x: 0, y: 0, z: 0 }, sourceY: 0,
      });
    }

    const s = enforceVoxelScale(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    this.sc.set(s.x, s.y, s.z);
  }

  setViewCullRadius(r: number): void {
    this.viewCullR = Math.max(32, r);
    this.rebuildSimChunks();
  }

  setViewCenter(x: number, z: number): void {
    this.viewX = x;
    this.viewZ = z;
    this.rebuildSimChunks();
  }

  private rebuildSimChunks(): void {
    this.simChunks.clear();
    const r = this.viewCullR * CULL_MARGIN + RUNTIME_CHUNK;
    const minCx = Math.floor((this.viewX - r) / RUNTIME_CHUNK);
    const maxCx = Math.floor((this.viewX + r) / RUNTIME_CHUNK);
    const minCz = Math.floor((this.viewZ - r) / RUNTIME_CHUNK);
    const maxCz = Math.floor((this.viewZ + r) / RUNTIME_CHUNK);
    for (let cz = minCz; cz <= maxCz; cz++)
      for (let cx = minCx; cx <= maxCx; cx++)
        this.simChunks.add(`${cx},${cz}`);
    this.stats.simChunks = this.simChunks.size;
  }

  setSources(sources: EmitterVoxel[]): void {
    this.sources = sources;
    this.regions = buildEmitterRegions(sources);
  }

  addPropSources(
    model: VoxelModel,
    frameId: string,
    worldX: number,
    worldY: number,
    worldZ: number,
    facing: 0 | 1 | 2 | 3 = 0,
  ): void {
    this.sources.push(...worldEmittersFromPlacement(model, frameId, worldX, worldY, worldZ, facing));
    this.regions = buildEmitterRegions(this.sources);
  }

  clearSources(): void {
    this.sources = [];
    this.regions = [];
  }

  render(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.emitFromRegions(dt);
    this.stepFire(dt);
    this.stepSmoke(dt);
    this.rebuildFireVisuals();
    this.rebuildSmokeVisuals();
  }

  dispose(): void {
    this.scene.remove(this.fireMesh);
    this.scene.remove(this.smokeMesh);
    this.fireMesh.geometry.dispose();
    this.smokeMesh.geometry.dispose();
    (this.fireMesh.material as THREE.Material).dispose();
    (this.smokeMesh.material as THREE.Material).dispose();
    this.sources = [];
    this.regions = [];
  }

  private chunkActive(x: number, z: number): boolean {
    return this.simChunks.has(runtimeChunkKey(x, z));
  }

  private inView(x: number, z: number): boolean {
    const dx = x - this.viewX;
    const dz = z - this.viewZ;
    const r = this.viewCullR * CULL_MARGIN;
    return dx * dx + dz * dz <= r * r;
  }

  private emitFromRegions(dt: number): void {
    this.fireAcc += dt;
    const interval = 0.014;
    if (!this.regions.length) return;

    while (this.fireAcc >= interval) {
      this.fireAcc -= interval;
      let spent = 0;
      const n = this.regions.length;
      for (let k = 0; k < n && spent < EMIT_BUDGET; k++) {
        const reg = this.regions[(this.emitStride + k) % n]!;
        if (!this.inView(reg.x, reg.z)) continue;

        if (reg.kind === 'smoke') {
          this.spawnSmoke(reg.x, reg.y + 0.6, reg.z, 0.5 + reg.strength * 0.25);
          spent++;
          continue;
        }

        const count = Math.min(2, 1 + Math.floor(reg.strength * 2));
        for (let i = 0; i < count && spent < EMIT_BUDGET; i++) {
          this.spawnFire(
            reg.x + (Math.random() - 0.5) * (1.2 + reg.strength * 2.4),
            reg.y + Math.random() * (0.8 + reg.strength * 1.2),
            reg.z + (Math.random() - 0.5) * (1.2 + reg.strength * 2.4),
            reg.strength,
            reg.y,
          );
          spent++;
        }
      }
      if (n > 0) this.emitStride = (this.emitStride + 1) % n;
    }
    this.stats.activeRegions = this.regions.filter((r) => this.inView(r.x, r.z)).length;
  }

  private spawnFire(x: number, y: number, z: number, intensity: number, sourceY: number): void {
    const i = this.allocFire();
    const p = this.fireParts[i]!;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.intensity = intensity;
    p.heat = 0.85 + intensity * 0.15;
    p.asSmoke = false;
    p.sourceY = sourceY;
    p.vx = (Math.random() - 0.5) * (2.5 + intensity * 3);
    p.vy = 14 + Math.random() * 16 + intensity * 12;
    p.vz = (Math.random() - 0.5) * (2.5 + intensity * 3);
    p.life = 0;
    p.maxLife = 0.55 + Math.random() * 0.9 + intensity * 1.1;
    updateDominantCell(p.x, p.y, p.z, p.render);
  }

  private spawnSmoke(x: number, y: number, z: number, strength = 1): void {
    const i = this.allocSmoke();
    const p = this.smokeParts[i]!;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.intensity = strength;
    p.heat = 0;
    p.asSmoke = true;
    p.vx = (Math.random() - 0.5) * 2.2 * strength;
    p.vy = 2.8 + Math.random() * 4.5 + strength * 1.5;
    p.vz = (Math.random() - 0.5) * 2.2 * strength;
    p.life = 0;
    p.maxLife = 3.5 + Math.random() * 5 + strength * 2;
    updateDominantCell(p.x, p.y, p.z, p.render);
  }

  private stepFire(dt: number): void {
    let active = 0;
    for (let i = 0; i < FIRE_PARTICLE_CAP; i++) {
      const p = this.fireParts[i]!;
      if (!p.active) continue;
      if (!this.inView(p.x, p.z)) continue;
      active++;

      p.life += dt;
      p.vy += (Math.random() - 0.28) * 18 * dt;
      p.vx += (Math.random() - 0.5) * 9 * dt;
      p.vz += (Math.random() - 0.5) * 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const heightAbove = Math.max(0, p.y - p.sourceY);
      p.heat -= dt * (0.35 + heightAbove * 0.04 + p.life / p.maxLife * 0.5);
      if (p.heat <= HEAT_SMOKE_THRESHOLD && !p.asSmoke) {
        p.asSmoke = true;
        p.vy *= 0.55;
      }

      if (p.life >= p.maxLife) p.active = false;
    }
    this.stats.activeFire = active;
  }

  private stepSmoke(dt: number): void {
    const windX = Math.sin(performance.now() * 0.00028) * 1.2;
    let active = 0;
    let fireAsSmoke = 0;
    for (let i = 0; i < SMOKE_PARTICLE_CAP; i++) {
      const p = this.smokeParts[i]!;
      if (!p.active) continue;
      if (!this.inView(p.x, p.z)) continue;
      active++;

      p.life += dt;
      p.vy += 0.55 * dt;
      p.vx += windX * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.life >= p.maxLife) p.active = false;
    }
    fireAsSmoke = this.fireParts.filter(
      (p) => p.active && p.asSmoke && this.inView(p.x, p.z),
    ).length;
    this.stats.activeSmoke = active + fireAsSmoke;
  }

  private accumulateFireCell(
    p: Particle,
    cells: Map<string, VisualCell>,
  ): void {
    if (!this.inView(p.x, p.z)) return;
    updateDominantCell(p.x, p.y, p.z, p.render);
    const { x: gx, y: gy, z: gz } = p.render;
    const key = cellKey(gx, gy, gz);
    let c = cells.get(key);
    if (!c) {
      c = { gx, gy, gz, weight: 0, ageSum: 0, heatSum: 0, billow: false, clusterMass: 1 };
      cells.set(key, c);
    }
    c.weight += 1;
    c.ageSum += p.life / p.maxLife;
    c.heatSum += p.heat;
  }

  private accumulateSmokeCell(
    p: Particle,
    cells: Map<string, VisualCell>,
  ): void {
    if (!this.inView(p.x, p.z)) return;
    updateDominantCell(p.x, p.y, p.z, p.render);
    const { x: gx, y: gy, z: gz } = p.render;
    const key = cellKey(gx, gy, gz);
    let c = cells.get(key);
    if (!c) {
      c = { gx, gy, gz, weight: 0, ageSum: 0, heatSum: 0, billow: false, clusterMass: 1 };
      cells.set(key, c);
    }
    c.weight += 1;
    c.ageSum += p.life / p.maxLife;
  }

  private rebuildFireVisuals(): void {
    const cells = this.fireScratch;
    cells.clear();
    for (let i = 0; i < FIRE_PARTICLE_CAP; i++) {
      const p = this.fireParts[i]!;
      if (!p.active || p.asSmoke) continue;
      this.accumulateFireCell(p, cells);
    }
    classifyFireClusters(cells);

    let inst = 0;
    for (const c of cells.values()) {
      if (inst >= FIRE_RENDER_CAP) break;
      const t = c.ageSum / Math.max(c.weight, 1);
      const avgHeat = c.heatSum / Math.max(c.weight, 1);
      const flicker = 0.7 + Math.random() * 0.35;
      if (avgHeat > 0.7 || t < 0.35) this.col.copy(COLOR_FIRE_C).multiplyScalar(flicker);
      else if (t < 0.72) this.col.copy(COLOR_FIRE_A).multiplyScalar(flicker);
      else this.col.copy(COLOR_FIRE_B).multiplyScalar(flicker);

      const scale = fireClusterScale(c.clusterMass, c.weight);
      this.v.copy(voxelCenter(c.gx, c.gy, c.gz));
      const sz = scale * VOXEL_UNIT;
      this.sc.set(sz, sz, sz);
      this.dummy.compose(this.v, this.q, this.sc);
      this.fireMesh.setMatrixAt(inst, this.dummy);
      this.fireMesh.setColorAt(inst, this.col);
      inst++;
    }
    const s = enforceVoxelScale(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    this.sc.set(s.x, s.y, s.z);

    this.fireMesh.count = inst;
    this.stats.fireInstances = inst;
    this.fireMesh.instanceMatrix.needsUpdate = true;
    if (this.fireMesh.instanceColor) this.fireMesh.instanceColor.needsUpdate = true;
    if (inst > 0) this.fireMesh.computeBoundingSphere();
  }

  private rebuildSmokeVisuals(): void {
    const cells = this.smokeScratch;
    cells.clear();
    for (let i = 0; i < SMOKE_PARTICLE_CAP; i++) {
      const p = this.smokeParts[i]!;
      if (!p.active) continue;
      this.accumulateSmokeCell(p, cells);
    }
    for (let i = 0; i < FIRE_PARTICLE_CAP; i++) {
      const p = this.fireParts[i]!;
      if (!p.active || !p.asSmoke) continue;
      this.accumulateSmokeCell(p, cells);
    }
    classifySmokeBillows(cells);

    let inst = 0;
    for (const c of cells.values()) {
      if (inst >= SMOKE_RENDER_CAP) break;
      const age = c.ageSum / Math.max(c.weight, 1);
      const density = Math.min(1, c.weight / 3);
      if (!c.billow && density < 0.2) continue;

      this.col.copy(COLOR_SMOKE_DARK).lerp(COLOR_SMOKE_LIGHT, age * 0.55 + density * 0.35);
      const puff = (c.billow ? 1.35 + density * 0.55 : 1.05) + Math.min(1.2, c.clusterMass * 0.08);
      this.v.copy(voxelCenter(c.gx, c.gy, c.gz));
      const sz = puff * VOXEL_UNIT;
      this.sc.set(sz, sz, sz);
      this.dummy.compose(this.v, this.q, this.sc);
      this.smokeMesh.setMatrixAt(inst, this.dummy);
      this.smokeMesh.setColorAt(inst, this.col);
      inst++;
    }
    const s = enforceVoxelScale(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    this.sc.set(s.x, s.y, s.z);

    this.smokeMesh.count = inst;
    this.stats.smokeInstances = inst;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    if (inst > 0) this.smokeMesh.computeBoundingSphere();
  }

  private allocFire(): number {
    for (let k = 0; k < FIRE_PARTICLE_CAP; k++) {
      const i = (this.fireNext + k) % FIRE_PARTICLE_CAP;
      if (!this.fireParts[i]!.active) {
        this.fireNext = (i + 1) % FIRE_PARTICLE_CAP;
        return i;
      }
    }
    const i = this.fireNext;
    this.fireNext = (i + 1) % FIRE_PARTICLE_CAP;
    return i;
  }

  private allocSmoke(): number {
    for (let k = 0; k < SMOKE_PARTICLE_CAP; k++) {
      const i = (this.smokeNext + k) % SMOKE_PARTICLE_CAP;
      if (!this.smokeParts[i]!.active) {
        this.smokeNext = (i + 1) % SMOKE_PARTICLE_CAP;
        return i;
      }
    }
    const i = this.smokeNext;
    this.smokeNext = (i + 1) % SMOKE_PARTICLE_CAP;
    return i;
  }
}
