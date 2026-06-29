import * as THREE from 'three';
import {
  VOXEL_UNIT,
  enforceVoxelScale,
  updateDominantCell,
  dominantVoxelCell,
  type TerrainField,
  type VoxelModel,
  worldEmittersFromPlacement,
} from '@voxelbound/shared';
import { unitVoxelGeometry, voxelCenter } from '../render/voxelGeometry';
import { FluidField, MIN_WATER_LAYER } from './FluidField';

/** A point on the river centreline: world position, surface height, half-width. */
export interface RiverPoint {
  x: number;
  z: number;
  y: number;
  half: number;
}

/**
 * Live water physics ({@link FluidField}) + Lego Movie-style voxel display.
 *
 * **One system for all water** (stream, lake, fountain basin): each wet column
 * owns a surface particle at continuous (x,y,z). The shallow-water sim drives
 * depth, velocity, and sub-cell drift. Spray arcs use the same particle pool.
 *
 * **Render:** round every particle to the voxel grid; merge XZ-connected bodies
 * into blue liquid; isolated cells are white splash.
 */

const GRAV = 46;
const WATER_RENDER_CAP = 32768;
const SPRAY_CAP = 768;
const WAKE_MARGIN = 1.08;

/** Shared water surface tint for all dynamic voxels. */
export const WATER_SURFACE_COLOR = 0x3885d1;
export const WATER_SURFACE_OPACITY = 0.8;

const COLOR_LIQUID = new THREE.Color(WATER_SURFACE_COLOR);
/** Foam / airborne spray — lighter but still blue-tinted, not opaque white. */
const COLOR_SPLASH = new THREE.Color(0.66, 0.82, 0.96);
const COLOR_MUD = new THREE.Color(0x5c4033);
const COLOR_MUD_WET = new THREE.Color(0x4a3328);

interface Droplet {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  floorY: number;
  life: number;
  maxLife: number;
  render: { x: number; y: number; z: number };
}

interface VisualCell {
  gx: number;
  gy: number;
  gz: number;
  bulk: number;
  spray: number;
  liquid: boolean;
  mud: boolean;
}

interface Fountain {
  x: number;
  z: number;
  rimY: number;
  acc: number;
}

interface WaterEmitter {
  x: number;
  y: number;
  z: number;
  acc: number;
}

interface Waterfall {
  x: number;
  z: number;
  topY: number;
  baseY: number;
  half: number;
  acc: number;
}

/** Bulk surface bodies merge on XZ; spray stays white unless it sits on bulk liquid. */
export function classifyLiquidClusters(cells: Map<string, VisualCell>): void {
  const byXz = new Map<string, string[]>();
  for (const [key, c] of cells) {
    const xz = `${c.gx},${c.gz}`;
    const list = byXz.get(xz);
    if (list) list.push(key);
    else byXz.set(xz, [key]);
  }

  const xzNeighbors: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const visited = new Set<string>();

  for (const startKey of cells.keys()) {
    if (visited.has(startKey)) continue;
    const start = cells.get(startKey)!;
    const cluster: VisualCell[] = [];
    const queue = [startKey];
    visited.add(startKey);

    while (queue.length) {
      const key = queue.pop()!;
      const c = cells.get(key)!;
      cluster.push(c);
      for (const [dx, dz] of xzNeighbors) {
        const nkeys = byXz.get(`${c.gx + dx},${c.gz + dz}`);
        if (!nkeys) continue;
        for (const nk of nkeys) {
          if (visited.has(nk)) continue;
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    const bulkCells = cluster.filter((c) => c.bulk > 0);
    const totalBulk = bulkCells.reduce((n, c) => n + c.bulk, 0);
    const liquid = bulkCells.length >= 2 || totalBulk >= 2;
    for (const c of cluster) {
      if (c.bulk > 0) c.liquid = liquid;
    }
  }
}

function cellKey(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}

export class WaterFeatures {
  private scene: THREE.Scene;
  private field: FluidField;

  /** All simulated water in view — ocean, lake, river, fountain. */
  private waterMesh: THREE.InstancedMesh;
  private drops: Droplet[] = [];
  private next = 0;
  private dummy = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();
  private cellScratch = new Map<string, VisualCell>();

  private fountains: Fountain[] = [];
  private waterEmitters: WaterEmitter[] = [];
  private waterfalls: Waterfall[] = [];
  private wadeAcc = 0;
  private player: { x: number; z: number } | null = null;
  private viewCullR = 120;

  /** Debug counters for overlay / tests. */
  readonly stats = {
    sprayActive: 0,
    waterInstances: 0,
    waterEmitters: 0,
  };

  constructor(scene: THREE.Scene, field: TerrainField) {
    this.scene = scene;
    this.field = new FluidField(field);

    const geo = unitVoxelGeometry();
    const mat = this.createWaterMaterial();
    this.waterMesh = new THREE.InstancedMesh(geo, mat, WATER_RENDER_CAP);
    this.waterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.waterMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(WATER_RENDER_CAP * 3).fill(1),
      3,
    );
    this.waterMesh.frustumCulled = true;
    this.waterMesh.renderOrder = 2;
    this.waterMesh.count = 0;
    this.scene.add(this.waterMesh);
    for (let i = 0; i < SPRAY_CAP; i++) {
      this.drops.push({
        active: false, x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0, floorY: 0, life: 0, maxLife: 1,
        render: { x: 0, y: 0, z: 0 },
      });
    }

    const s = enforceVoxelScale(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    this.sc.set(s.x, s.y, s.z);
  }

  private createWaterMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      // White base; per-instance blue comes from setColorAt.
      color: 0xffffff,
      transparent: true,
      opacity: WATER_SURFACE_OPACITY,
      depthWrite: false,
    });
  }

  /** No-op — all water is dynamic; kept for call-site compatibility. */
  finalizeStaticWater(): void {}

  seedFountain(cx: number, cz: number, baseY: number): void {
    const basinFloor = baseY + 1.8;
    const basinRim = baseY + 4.5;
    const bowlFloor = baseY + 5.2;
    const bowlRim = baseY + 6.6;

    const basin = this.field.seedDisc(cx, cz, 10, basinFloor);
    this.field.fillTo(basin, basinRim - 0.3);
    this.field.setDrain(basin, basinRim);

    const bowl = this.field.seedDisc(cx, cz, 4.5, bowlFloor);
    this.field.fillTo(bowl, bowlRim - 0.15);
    this.field.setDrain(bowl, bowlRim);

    this.field.addSource(cx, cz, 3.2, bowlRim);
    this.field.markLive(basin);
    this.field.markLive(bowl);
    this.fountains.push({ x: cx, z: cz, rimY: bowlRim, acc: 0 });
  }

  /** Register water palette emitters from a placed prop (fountain spout, etc.). */
  addPropWaterEmitters(
    model: VoxelModel,
    frameId: string,
    worldX: number,
    worldY: number,
    worldZ: number,
    facing: 0 | 1 | 2 | 3 = 0,
  ): void {
    const raw = worldEmittersFromPlacement(model, frameId, worldX, worldY, worldZ, facing).filter(
      (e) => e.kind === 'water',
    );
    if (!raw.length) return;
    const maxY = Math.max(...raw.map((e) => e.y));
    const top = raw.filter((e) => e.y >= maxY - 0.6);
    const step = Math.max(1, Math.floor(top.length / 3));
    for (let i = 0; i < top.length; i += step) {
      const e = top[i]!;
      this.waterEmitters.push({ x: e.x, y: e.y, z: e.z, acc: 0 });
      if (this.waterEmitters.length >= 3) break;
    }
  }

  clearWaterEmitters(): void {
    this.waterEmitters = [];
  }

  seedRiver(pts: RiverPoint[]): void {
    if (pts.length < 2) return;
    const strip = pts.map((p) => ({ x: p.x, z: p.z, half: p.half }));
    const cells = this.field.seedPath(strip);
    for (const i of cells) {
      const bed = this.field.bedAt(i);
      const surf = this.riverSurfaceAt(this.field.cellX(i), this.field.cellZ(i), pts);
      if (surf !== null) this.field.fillTo([i], Math.max(surf, bed + MIN_WATER_LAYER));
    }

    const head = pts[0]!;
    const foot = pts[pts.length - 1]!;
    this.field.addSource(head.x, head.z, 4, head.y + 1.2);
    const footCells = this.field.seedDisc(foot.x, foot.z, foot.half + 1, undefined);
    this.field.setDrain(footCells, foot.y);
    this.field.markLive(cells);
    this.field.markLive(footCells);
    this.field.wakeNear(head.x, head.z, Math.max(head.half + 6, 12));

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const horiz = Math.hypot(b.x - a.x, b.z - a.z);
      const fall = a.y - b.y;
      if (fall > 4 && fall > horiz * 0.6) {
        this.waterfalls.push({
          x: (a.x + b.x) / 2,
          z: (a.z + b.z) / 2,
          topY: a.y,
          baseY: b.y,
          half: Math.min(a.half, b.half),
          acc: 0,
        });
      }
    }
  }

  /** Every submerged column on the heightfield — ocean, lakes, coastlines. */
  seedOpenWater(seaLevel: number, _field: TerrainField): void {
    this.field.seedSubmerged(seaLevel);
  }

  /** Big mud pit — viscous, holds tracks, same sim as water. */
  seedMudPit(cx: number, cz: number, r: number, surfaceY: number): void {
    this.field.seedMudDisc(cx, cz, r, surfaceY);
  }

  /** True when standing in simulated mud (for movement slowdown). */
  inMud(x: number, z: number): boolean {
    return this.field.isMudAt(x, z) && this.field.depthAt(x, z) >= MIN_WATER_LAYER * 0.4;
  }

  /** Match camera view footprint so we never sim/render off-screen water. */
  setViewCullRadius(r: number): void {
    this.viewCullR = Math.max(32, r);
  }

  /** Shallow simulated water — player can wade when depth exceeds this. */
  depthAt(x: number, z: number): number {
    return this.field.depthAt(x, z);
  }

  /** Mark every simulated column walkable on the terrain mask. */
  markTerrainWalkable(field: TerrainField): void {
    this.field.forEachMaskedColumn((x, z) => {
      const i = z * field.w + x;
      field.walkable[i] = 1;
    });
  }

  step(dt: number, player?: { x: number; z: number }): void {
    if (player) this.player = player;
    this.field.clearObstacles();
    if (this.player) {
      const wading = this.field.depthAt(this.player.x, this.player.z) >= MIN_WATER_LAYER * 0.5;
      const wakeR = wading
        ? Math.min(this.viewCullR * 0.85, 96)
        : Math.min(36, this.viewCullR * 0.4);
      this.field.wakeNear(this.player.x, this.player.z, wakeR);
      this.field.stampObstacle(this.player.x, this.player.z, 1.1, 50);
    }
    this.field.step(dt);
  }

  wade(x: number, z: number, dt: number): void {
    const depth = this.field.depthAt(x, z);
    if (depth < MIN_WATER_LAYER * 0.5) return;
    const mud = this.field.isMudAt(x, z);
    const push = mud ? 14 : 22;
    const lift = mud ? MIN_WATER_LAYER * 0.1 : MIN_WATER_LAYER * 0.14;
    this.field.impulse(x, z, push, lift);
    this.wadeAcc += dt;
    if (mud) return;
    if (this.wadeAcc < 0.06) return;
    this.wadeAcc = 0;
    const surf = this.field.surfaceAt(x, z);
    if (surf === -Infinity) return;
    for (let k = 0; k < 6; k++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 9;
      this.emitSpray(
        x + (Math.random() - 0.5) * 0.8,
        surf + MIN_WATER_LAYER * 0.45,
        z + (Math.random() - 0.5) * 0.8,
        Math.cos(ang) * sp,
        8 + Math.random() * 11,
        Math.sin(ang) * sp,
        surf,
      );
    }
  }

  render(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.emitSources(dt);
    this.stepDroplets(dt);
    this.rebuildMergedVisuals();
  }

  dispose(): void {
    this.scene.remove(this.waterMesh);
    this.waterMesh.geometry.dispose();
    (this.waterMesh.material as THREE.Material).dispose();
    this.fountains = [];
    this.waterEmitters = [];
    this.waterfalls = [];
  }

  private inView(x: number, z: number): boolean {
    const px = this.player?.x ?? this.field.w * 0.5;
    const pz = this.player?.z ?? this.field.d * 0.5;
    const r = this.viewCullR * WAKE_MARGIN;
    const dx = x - px;
    const dz = z - pz;
    return dx * dx + dz * dz <= r * r;
  }

  private emitSources(dt: number): void {
    for (const e of this.waterEmitters) {
      if (!this.inView(e.x, e.z)) continue;
      e.acc += dt;
      while (e.acc >= 0.1) {
        e.acc -= 0.1;
        const ang = Math.random() * Math.PI * 2;
        const out = 0.8 + Math.random() * 2.2;
        const lift = 10 + Math.random() * 8;
        this.emitSpray(
          e.x + (Math.random() - 0.5) * 0.4,
          e.y + 0.3 + Math.random() * 0.3,
          e.z + (Math.random() - 0.5) * 0.4,
          Math.cos(ang) * out,
          lift,
          Math.sin(ang) * out,
          e.y - 1.5,
        );
      }
    }
    for (const wf of this.waterfalls) {
      if (!this.inView(wf.x, wf.z)) continue;
      wf.acc += dt;
      while (wf.acc >= 0.06) {
        wf.acc -= 0.06;
        const lx = wf.x + (Math.random() - 0.5) * wf.half * 1.2;
        const lz = wf.z + (Math.random() - 0.5) * wf.half * 1.2;
        this.emitSpray(
          lx,
          wf.topY - Math.random() * 1.2,
          lz,
          (Math.random() - 0.5) * 1.5,
          -1.5 - Math.random() * 2.5,
          (Math.random() - 0.5) * 1.5,
          wf.baseY + MIN_WATER_LAYER,
        );
      }
    }
  }

  private stepDroplets(dt: number): void {
    for (let i = 0; i < SPRAY_CAP; i++) {
      const p = this.drops[i]!;
      if (!p.active) continue;
      p.life += dt;
      p.vy -= GRAV * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y <= p.floorY) {
        this.field.depositAt(p.x, p.z);
        this.field.impulse(p.x, p.z, 3, MIN_WATER_LAYER * 0.05);
        p.active = false;
        continue;
      }
      if (p.life >= p.maxLife) p.active = false;
    }
    this.stats.sprayActive = this.drops.filter((p) => p.active).length;
  }

  /** Snap continuous positions → grid, cluster, draw all water in view. */
  private rebuildMergedVisuals(): void {
    const cells = this.cellScratch;
    cells.clear();

    const px = this.player?.x ?? this.field.w * 0.5;
    const pz = this.player?.z ?? this.field.d * 0.5;
    const r = this.viewCullR * WAKE_MARGIN;

    // Bulk surface: snap drifted sim positions to the voxel grid (blocky ripples).
    this.field.forEachSurfaceParticleNear(px, pz, r, (wx, wy, wz, colGx, colGz) =>
      this.snapBulkParticle(wx, wy, wz, colGx, colGz, cells),
    );

    for (let i = 0; i < SPRAY_CAP; i++) {
      const p = this.drops[i]!;
      if (!p.active) continue;
      const dx = p.x - px;
      const dz = p.z - pz;
      if (dx * dx + dz * dz > r * r) continue;
      updateDominantCell(p.x, p.y, p.z, p.render);
      this.accumulateCell(p.render.x, p.render.y, p.render.z, cells, 'spray');
    }

    classifyLiquidClusters(cells);

    let inst = 0;
    // Bulk surface: one full voxel per wet column (never merge lakes/rivers into blobs).
    for (const c of cells.values()) {
      if (inst >= WATER_RENDER_CAP) break;
      if (c.bulk <= 0) continue;
      this.v.copy(voxelCenter(c.gx, c.gy, c.gz));
      this.sc.set(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
      this.dummy.compose(this.v, this.q, this.sc);
      this.waterMesh.setMatrixAt(inst, this.dummy);
      if (c.mud) {
        this.col.copy(c.liquid ? COLOR_MUD_WET : COLOR_MUD);
      } else {
        this.col.copy(c.liquid ? COLOR_LIQUID : COLOR_SPLASH);
      }
      this.waterMesh.setColorAt(inst, this.col);
      inst++;
    }

    // Spray: one unit cube per occupied cell; cluster membership tints color only.
    for (const c of cells.values()) {
      if (inst >= WATER_RENDER_CAP) break;
      if (c.spray <= 0) continue;
      this.v.copy(voxelCenter(c.gx, c.gy, c.gz));
      this.sc.set(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
      this.dummy.compose(this.v, this.q, this.sc);
      this.waterMesh.setMatrixAt(inst, this.dummy);
      if (c.liquid) {
        this.col.copy(COLOR_LIQUID);
        if (c.spray >= 2) this.col.lerp(COLOR_SPLASH, 0.15);
      } else {
        this.col.copy(COLOR_SPLASH);
      }
      this.waterMesh.setColorAt(inst, this.col);
      inst++;
    }

    const s = enforceVoxelScale(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    this.sc.set(s.x, s.y, s.z);

    this.waterMesh.count = inst;
    this.stats.waterInstances = inst;
    this.stats.waterEmitters = this.waterEmitters.length;
    this.waterMesh.instanceMatrix.needsUpdate = true;
    if (this.waterMesh.instanceColor) this.waterMesh.instanceColor.needsUpdate = true;
    if (inst > 0) this.waterMesh.computeBoundingSphere();
  }

  /** Snap drifted sim particle to dominant voxel cell (blocky ripple, unit cubes). */
  private snapBulkParticle(
    wx: number,
    wy: number,
    wz: number,
    colGx: number,
    colGz: number,
    cells: Map<string, VisualCell>,
  ): void {
    const { x: gx, y: gy, z: gz } = dominantVoxelCell(wx, wy, wz);
    const key = cellKey(gx, gy, gz);
    let c = cells.get(key);
    if (!c) {
      c = {
        gx,
        gy,
        gz,
        bulk: 0,
        spray: 0,
        liquid: false,
        mud: this.field.isMudAt(colGx, colGz),
      };
      cells.set(key, c);
    }
    c.bulk += 1;
  }

  private accumulateCell(
    gx: number,
    gy: number,
    gz: number,
    cells: Map<string, VisualCell>,
    kind: 'bulk' | 'spray',
  ): void {
    const key = cellKey(gx, gy, gz);
    let c = cells.get(key);
    if (!c) {
      c = { gx, gy, gz, bulk: 0, spray: 0, liquid: false, mud: false };
      cells.set(key, c);
    }
    if (kind === 'bulk') c.bulk += 1;
    else c.spray += 1;
  }

  private emitSpray(x: number, y: number, z: number, vx: number, vy: number, vz: number, floorY: number): void {
    const i = this.alloc();
    const p = this.drops[i]!;
    p.active = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.floorY = floorY;
    p.life = 0;
    p.maxLife = 2.4;
    updateDominantCell(p.x, p.y, p.z, p.render);
  }

  private alloc(): number {
    for (let k = 0; k < SPRAY_CAP; k++) {
      const i = (this.next + k) % SPRAY_CAP;
      if (!this.drops[i]!.active) {
        this.next = (i + 1) % SPRAY_CAP;
        return i;
      }
    }
    const i = this.next;
    this.next = (i + 1) % SPRAY_CAP;
    return i;
  }

  private riverSurfaceAt(x: number, z: number, pts: RiverPoint[]): number | null {
    let best = Infinity;
    let surf = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) {
        best = d;
        surf = a.y + (b.y - a.y) * t;
      }
    }
    return best < 64 ? surf : null;
  }
}
