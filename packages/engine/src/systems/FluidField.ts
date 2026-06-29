// ---------------------------------------------------------------------------
// Shallow-water heightfield fluid. A column-per-cell simulation that runs over
// the terrain heightfield using the "virtual pipes" method (Mei et al.): water
// flows between 4-neighbours driven by the difference in surface height, so it
// runs downhill, fills basins, levels out, and flows around obstacles — real
// water behaviour rather than a flat plane.
//
// Only masked cells (seeded regions: fountain, river, lake) are simulated, and
// only *active* cells are stepped each tick, so a calm lake costs nothing until
// something disturbs it. Volume is conserved by the pipe flux being clamped to
// the water actually available in each cell.
// ---------------------------------------------------------------------------

import { VOXEL_UNIT, snapVoxelCell, type TerrainField } from '@voxelbound/shared';

/** Flux carried per directed pipe; tuned for grid spacing = 1 world unit. */
const GRAVITY = 9.0;
/** Per-step flux damping (bleeds momentum so water settles instead of sloshing forever). */
const FLUX_DAMP = 0.96;
/** Depths below this are treated as dry. */
const MIN_DEPTH = 1e-3;
/** Wet columns always hold at least one voxel layer above the terrain top. */
export const MIN_WATER_LAYER = VOXEL_UNIT;
/** A cell with this much through-flux (or this much depth change) stays awake. */
const ACTIVE_EPS = 2e-3;
/** Isolated splash dries up (depth units / s). */
const EVAP_RATE = 2.2;
/** Small puddles smaller than this (wet cell count) can evaporate. */
const MIN_BODY = 6;
/** Spill excess downhill when surface is higher than a neighbour. */
const DRIBBLE_RATE = 3.5;
/** Velocity below this is treated as still. */
const VEL_SLEEP = 0.12;
/** Run stranded-evap every N sim steps (cheaper than every tick). */
const EVAP_INTERVAL = 12;

export interface SubmergedSeedOpts {
  /** @deprecated All submerged terrain is seeded; option ignored. */
  lakeOnly?: boolean;
  lakeX?: number;
  lakeZ?: number;
  lakeR?: number;
}

interface Source {
  i: number;
  /** Depth units added per second. */
  rate: number;
  /** Stop adding once the surface reaches this height (bowl rim / spring cap). */
  maxSurface: number;
}

/** A read-only view of one wet cell, reused by {@link FluidField.forEachWet}. */
export interface WetCell {
  x: number;
  z: number;
  bed: number;
  depth: number;
  surface: number;
  speed: number;
}

export class FluidField {
  readonly w: number;
  readonly d: number;

  /** Per-column bed (terrain height, or a raised override for fountain bowls). */
  private bed: Float32Array;
  /** Water depth above the bed. */
  private h: Float32Array;
  /** Outflow flux toward -x / +x / -z / +z neighbours. */
  private fL: Float32Array;
  private fR: Float32Array;
  private fT: Float32Array;
  private fB: Float32Array;
  /** Horizontal velocity (derived from flux; advects surface particles). */
  private vx: Float32Array;
  private vz: Float32Array;
  /** Sub-cell particle offset from column centre (continuous x/z within the column). */
  private px: Float32Array;
  private pz: Float32Array;
  /** Dynamic solid height added on top of the bed (player footprint, dropped props). */
  private obstacle: Float32Array;
  /** Surface clamp: water above this is drained away (lake/ocean equilibrium). +Inf = no clamp. */
  private drain: Float32Array;
  /** Equilibrium depth above bed (from seeding); water relaxes here when calm. */
  private restDepth: Float32Array;
  /** 1 = simulated column. */
  private mask: Uint8Array;
  /** 1 = river/fountain — stay awake longer when disturbed. */
  private live: Uint8Array;
  /** 1 = thick mud (slow flow, holds tracks, brown render). */
  private mud: Uint8Array;

  /** Stable list of masked cell indices (fixed render topology). */
  private masked: number[] = [];
  /** Cells stepped this tick. */
  private active = new Set<number>();
  private sources: Source[] = [];
  private stepCounter = 0;

  private scratch: WetCell = { x: 0, z: 0, bed: 0, depth: 0, surface: 0, speed: 0 };

  constructor(field: TerrainField) {
    this.w = field.w;
    this.d = field.d;
    const n = field.w * field.d;
    this.bed = Float32Array.from(field.height);
    this.h = new Float32Array(n);
    this.fL = new Float32Array(n);
    this.fR = new Float32Array(n);
    this.fT = new Float32Array(n);
    this.fB = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.obstacle = new Float32Array(n);
    this.drain = new Float32Array(n).fill(Infinity);
    this.restDepth = new Float32Array(n).fill(NaN);
    this.mask = new Uint8Array(n);
    this.live = new Uint8Array(n);
    this.mud = new Uint8Array(n);
  }

  private idx(x: number, z: number): number {
    return z * this.w + x;
  }

  /** Snapshot of every masked cell, in seeding order (drives the surface mesh). */
  maskedCells(): readonly number[] {
    return this.masked;
  }

  cellX(i: number): number {
    return i % this.w;
  }
  cellZ(i: number): number {
    return Math.floor(i / this.w);
  }
  bedAt(i: number): number {
    return this.bed[i]!;
  }
  depthIdx(i: number): number {
    return this.h[i]!;
  }
  surfaceIdx(i: number): number {
    return this.bed[i]! + this.h[i]!;
  }
  speedIdx(i: number): number {
    return Math.hypot(this.vx[i]!, this.vz[i]!);
  }

  // -- seeding --------------------------------------------------------------

  /** Mark a disc of columns simulated. Optional bedY raises the floor (fountain bowls). */
  seedDisc(cx: number, cz: number, r: number, bedY?: number): number[] {
    const out: number[] = [];
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(this.d - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x - cx, z - cz) > r) continue;
        const i = this.idx(x, z);
        if (this.addMasked(i)) {
          if (bedY !== undefined) this.bed[i] = bedY;
          out.push(i);
        }
      }
    }
    return out;
  }

  /** Mark a capsule strip along a polyline simulated (river channel). */
  seedPath(pts: ReadonlyArray<{ x: number; z: number; half: number }>): number[] {
    const out: number[] = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]!;
      const b = pts[s + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        const half = a.half + (b.half - a.half) * t;
        const r = Math.ceil(half);
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.hypot(dx, dz) > half) continue;
            const x = Math.round(px + dx);
            const z = Math.round(pz + dz);
            if (x < 0 || z < 0 || x >= this.w || z >= this.d) continue;
            const i = this.idx(x, z);
            if (this.addMasked(i)) out.push(i);
          }
        }
      }
    }
    return out;
  }

  private addMasked(i: number): boolean {
    if (this.mask[i]) return false;
    this.mask[i] = 1;
    this.masked.push(i);
    return true;
  }

  /**
   * Mask every column below `seaLevel` and fill to a flat surface.
   * Skips cells already seeded (fountain bowls, river channel, etc.).
   */
  seedSubmerged(seaLevel: number, _opts?: SubmergedSeedOpts): number[] {
    const added: number[] = [];

    for (let z = 0; z < this.d; z++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, z);
        if (this.mask[i]) continue;
        const bed = this.bed[i]!;
        if (bed >= seaLevel) continue;

        this.addMasked(i);
        const depth = Math.max(seaLevel - bed, MIN_WATER_LAYER);
        this.h[i] = depth;
        this.restDepth[i] = depth;
        this.drain[i] = seaLevel;
        added.push(i);
      }
    }
    return added;
  }

  /**
   * Shallow mud pit — same heightfield sim as water but viscous, holds footprints,
   * and relaxes slowly back toward rest depth.
   */
  seedMudDisc(cx: number, cz: number, r: number, surfaceY: number, depth = MIN_WATER_LAYER * 1.2): number[] {
    const cells = this.seedDisc(cx, cz, r);
    for (const i of cells) {
      this.mud[i] = 1;
      const d = Math.max(depth, surfaceY - this.bed[i]!, MIN_WATER_LAYER);
      this.h[i] = d;
      this.restDepth[i] = d;
      this.wake(i);
    }
    return cells;
  }

  /** River / fountain columns — always eligible for live sim + dynamic render. */
  markLive(cells: ReadonlyArray<number>): void {
    for (const i of cells) if (this.mask[i]) this.live[i] = 1;
  }

  isLive(i: number): boolean {
    return this.live[i]! === 1;
  }

  isMudAt(x: number, z: number): boolean {
    const ix = Math.round(x);
    const iz = Math.round(z);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return false;
    const i = this.idx(ix, iz);
    return this.mask[i]! === 1 && this.mud[i]! === 1;
  }

  isActive(i: number): boolean {
    return this.active.has(i);
  }

  /** Pre-fill the given cells to a target surface height and leave them calm. */
  fillTo(cells: ReadonlyArray<number>, surfaceY: number): void {
    for (const i of cells) {
      const minSurface = this.bed[i]! + MIN_WATER_LAYER;
      const target = Math.max(surfaceY, minSurface);
      const depth = target - this.bed[i]!;
      if (depth >= MIN_WATER_LAYER) {
        this.h[i] = depth;
        this.restDepth[i] = depth;
      }
    }
  }

  /** Keep these cells from rising above `level` (acts as a sink / open shoreline). */
  setDrain(cells: ReadonlyArray<number>, level: number): void {
    for (const i of cells) this.drain[i] = level;
  }

  /** A persistent inflow (fountain spout, river spring). */
  addSource(x: number, z: number, rate: number, maxSurface: number): void {
    const i = this.idx(Math.round(x), Math.round(z));
    if (!this.mask[i]) this.addMasked(i);
    this.live[i] = 1;
    this.sources.push({ i, rate, maxSurface });
    this.active.add(i);
  }

  // -- dynamic interaction --------------------------------------------------

  /** Reset all dynamic obstacles (call once per tick before re-stamping). */
  clearObstacles(): void {
    this.obstacle.fill(0);
  }

  /** Raise a solid disc so water flows around it (player, dropped object). */
  stampObstacle(cx: number, cz: number, r: number, height: number): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(this.d - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.idx(x, z);
        if (!this.mask[i]) continue;
        if (Math.hypot(x - cx, z - cz) > r) continue;
        this.obstacle[i] = Math.max(this.obstacle[i]!, height);
        this.wake(i);
      }
    }
  }

  /** Shove water outward from a point and lift it a touch — wading / splashes. */
  impulse(cx: number, cz: number, push: number, lift: number): void {
    const r = 2.4;
    const x0 = Math.max(1, Math.floor(cx - r));
    const x1 = Math.min(this.w - 2, Math.ceil(cx + r));
    const z0 = Math.max(1, Math.floor(cz - r));
    const z1 = Math.min(this.d - 2, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.idx(x, z);
        if (!this.mask[i] || this.h[i]! <= MIN_DEPTH) continue;
        const dx = x - cx;
        const dz = z - cz;
        const dist = Math.hypot(dx, dz) || 1;
        if (dist > r) continue;
        const f = (1 - dist / r) * push;
        this.vx[i] = this.vx[i]! + (dx / dist) * f;
        this.vz[i] = this.vz[i]! + (dz / dist) * f;
        this.px[i] = this.px[i]! + (dx / dist) * f * 0.12;
        this.pz[i] = this.pz[i]! + (dz / dist) * f * 0.12;
        const liftAmt = lift * (1 - dist / r);
        if (this.mud[i]) {
          this.h[i] = this.h[i]! + liftAmt * 0.65;
        } else if (!Number.isNaN(this.restDepth[i]!)) {
          const rest = this.restDepth[i]!;
          this.h[i] = Math.min(this.h[i]! + liftAmt, rest + 0.18);
        } else {
          this.h[i] = Math.max(0, this.h[i]! + liftAmt);
        }
        this.wake(i);
      }
    }
  }

  /** Keep sim alive near the player so all water responds on contact. */
  wakeNear(cx: number, cz: number, r: number): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(this.d - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x - cx, z - cz) > r) continue;
        const i = this.idx(x, z);
        if (this.mask[i] && this.h[i]! > MIN_DEPTH) this.wake(i);
      }
    }
  }

  private isSource(i: number): boolean {
    for (const s of this.sources) if (s.i === i) return true;
    return false;
  }

  /** Target calm depth for column `i`. */
  private targetDepth(i: number): number {
    const rest = this.restDepth[i]!;
    if (!Number.isNaN(rest)) return rest;
    const drainLevel = this.drain[i]!;
    if (drainLevel !== Infinity) {
      return Math.max(MIN_WATER_LAYER, drainLevel - this.bed[i]!);
    }
    return MIN_WATER_LAYER;
  }

  private wake(i: number): void {
    this.active.add(i);
  }

  /** Mark cells active so a seeded imbalance settles (or a region starts flowing). */
  wakeCells(cells: ReadonlyArray<number>): void {
    for (const i of cells) if (this.mask[i]) this.active.add(i);
  }

  // -- query ----------------------------------------------------------------

  surfaceAt(x: number, z: number): number {
    const ix = Math.round(x / VOXEL_UNIT);
    const iz = Math.round(z / VOXEL_UNIT);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return -Infinity;
    const i = this.idx(ix, iz);
    if (this.h[i]! <= MIN_DEPTH) return -Infinity;
    return this.surfaceWorld(i);
  }

  depthAt(x: number, z: number): number {
    const ix = Math.round(x);
    const iz = Math.round(z);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return 0;
    return this.h[this.idx(ix, iz)]!;
  }

  // -- step -----------------------------------------------------------------

  step(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 30);

    for (const s of this.sources) {
      const surface = this.bed[s.i]! + this.h[s.i]!;
      if (surface < s.maxSurface) {
        this.h[s.i] = Math.min(this.h[s.i]! + s.rate * dt, s.maxSurface - this.bed[s.i]!);
      }
      this.wake(s.i);
    }

    if (this.active.size > 0) {
      const cells = Array.from(this.active);
      const w = this.w;

      for (const i of cells) {
        const hi = this.h[i]!;
        const top = this.bed[i]! + this.obstacle[i]! + hi;
        const x = i % w;
        const z = (i - x) / w;

        let fl = 0, fr = 0, ft = 0, fb = 0;
        if (hi > MIN_DEPTH) {
          if (x > 0 && this.mask[i - 1]) fl = this.pipe(this.fL[i]!, top, i - 1, dt, i);
          if (x < w - 1 && this.mask[i + 1]) fr = this.pipe(this.fR[i]!, top, i + 1, dt, i);
          if (z > 0 && this.mask[i - w]) ft = this.pipe(this.fT[i]!, top, i - w, dt, i);
          if (z < this.d - 1 && this.mask[i + w]) fb = this.pipe(this.fB[i]!, top, i + w, dt, i);

          const out = (fl + fr + ft + fb) * dt;
          if (out > hi) {
            const k = hi / out;
            fl *= k; fr *= k; ft *= k; fb *= k;
          }
        }
        this.fL[i] = fl; this.fR[i] = fr; this.fT[i] = ft; this.fB[i] = fb;
      }

      const next = new Set<number>();
      const update = this.continuityNeighbours();
      for (const i of update) {
        const x = i % w;
        const z = (i - x) / w;
        const outflow = this.fL[i]! + this.fR[i]! + this.fT[i]! + this.fB[i]!;
        const inL = x > 0 ? this.fR[i - 1]! : 0;
        const inR = x < w - 1 ? this.fL[i + 1]! : 0;
        const inT = z > 0 ? this.fB[i - w]! : 0;
        const inB = z < this.d - 1 ? this.fT[i + w]! : 0;
        const inflow = inL + inR + inT + inB;

        const dh = (inflow - outflow) * dt;
        let h = this.h[i]! + dh;
        if (h < 0) h = 0;

        const drainLevel = this.drain[i]!;
        if (drainLevel !== Infinity) {
          const maxDepth = drainLevel - this.bed[i]!;
          if (h > maxDepth) h = Math.max(0, maxDepth);
        }
        this.h[i] = h;

        const hbar = Math.max(h, 0.2);
        this.vx[i] = ((inL - this.fL[i]!) + (this.fR[i]! - inR)) * 0.5 / hbar;
        this.vz[i] = ((inT - this.fT[i]!) + (this.fB[i]! - inB)) * 0.5 / hbar;

        const target = this.targetDepth(i);
        const unsettled = h > MIN_DEPTH && Math.abs(h - target) > 0.04;
        const downhill = h > MIN_DEPTH && this.downhillDrop(i) > 0.04;
        const moving =
          outflow + inflow > ACTIVE_EPS ||
          Math.abs(dh) > ACTIVE_EPS ||
          Math.hypot(this.vx[i]!, this.vz[i]!) > VEL_SLEEP;
        const ripple = Math.hypot(this.px[i]!, this.pz[i]!) > 0.02;
        const stayAwake =
          h > MIN_DEPTH &&
          (moving || unsettled || downhill || ripple || (this.live[i]! && moving));

        if (stayAwake && h > MIN_DEPTH) {
          next.add(i);
        } else if (h > MIN_DEPTH) {
          this.vx[i] = 0;
          this.vz[i] = 0;
          this.fL[i] = 0;
          this.fR[i] = 0;
          this.fT[i] = 0;
          this.fB[i] = 0;
        }
      }

      for (const s of this.sources) next.add(s.i);
      this.active = next;
    }

    if (this.active.size > 0) {
      this.downhillDribble(dt, this.active);
      this.dampMotion(dt, this.active);
      this.advectSurfaceParticles(dt, this.active);
    }
    this.stepCounter++;
    if (this.stepCounter % EVAP_INTERVAL === 0) {
      this.evaporateStranded(dt * EVAP_INTERVAL);
    }
  }

  /** Active cells plus masked 4-neighbours (enough for one continuity pass). */
  private continuityNeighbours(): Set<number> {
    const w = this.w;
    const out = new Set<number>();
    for (const i of this.active) {
      out.add(i);
      const x = i % w;
      const z = (i - x) / w;
      if (x > 0 && this.mask[i - 1]) out.add(i - 1);
      if (x < w - 1 && this.mask[i + 1]) out.add(i + 1);
      if (z > 0 && this.mask[i - w]) out.add(i - w);
      if (z < this.d - 1 && this.mask[i + w]) out.add(i + w);
    }
    return out;
  }

  /** Surface height excess toward the lowest 4-neighbour (0 when level). */
  private downhillDrop(i: number): number {
    const hi = this.h[i]!;
    if (hi <= MIN_DEPTH) return 0;
    const w = this.w;
    const x = i % w;
    const z = (i - x) / w;
    const top = this.bed[i]! + hi;
    let bestDrop = 0;
    const consider = (j: number, ok: boolean): void => {
      if (!ok || !this.mask[j]) return;
      bestDrop = Math.max(bestDrop, top - (this.bed[j]! + this.h[j]!));
    };
    consider(i - 1, x > 0);
    consider(i + 1, x < w - 1);
    consider(i - w, z > 0);
    consider(i + w, z < this.d - 1);
    return bestDrop;
  }

  /** Spill to lower neighbours so hillside / overflow water always rolls downhill. */
  private downhillDribble(dt: number, cells: Iterable<number>): void {
    for (const i of cells) {
      const hi = this.h[i]!;
      if (hi <= MIN_DEPTH) continue;
      const bestDrop = this.downhillDrop(i);
      if (bestDrop <= 0.03) continue;
      const w = this.w;
      const x = i % w;
      const z = (i - x) / w;
      const top = this.bed[i]! + hi;
      let bestJ = -1;
      let drop = 0;
      const consider = (j: number, ok: boolean): void => {
        if (!ok || !this.mask[j]) return;
        const d = top - (this.bed[j]! + this.h[j]!);
        if (d > drop + 0.03) {
          drop = d;
          bestJ = j;
        }
      };
      consider(i - 1, x > 0);
      consider(i + 1, x < w - 1);
      consider(i - w, z > 0);
      consider(i + w, z < this.d - 1);
      if (bestJ < 0) continue;
      const move = Math.min(DRIBBLE_RATE * dt * bestDrop, hi * 0.4);
      if (move < 0.02) continue;
      this.h[i] = hi - move;
      this.h[bestJ] = this.h[bestJ]! + move;
      this.wake(i);
      this.wake(bestJ);
    }
  }

  /** Bleed velocity and relax depth toward rest so ripples settle instead of streaking. */
  private dampMotion(dt: number, cells: Iterable<number>): void {
    for (const i of cells) {
      if (this.h[i]! <= MIN_DEPTH) continue;
      const speed = Math.hypot(this.vx[i]!, this.vz[i]!);
      if (speed < VEL_SLEEP) {
        this.vx[i] = 0;
        this.vz[i] = 0;
      } else {
        const mudSlow = this.mud[i] ? 0.92 : 0.82;
        const damp = Math.pow(mudSlow, dt * 60);
        this.vx[i] = this.vx[i]! * damp;
        this.vz[i] = this.vz[i]! * damp;
      }

      const target = this.targetDepth(i);
      const h = this.h[i]!;
      const hasRest = !Number.isNaN(this.restDepth[i]!);
      const rest = hasRest ? this.restDepth[i]! : target;
      const rate = this.mud[i] ? 0.6 : 5.5;
      if (this.mud[i]) {
        const diff = rest - h;
        if (Math.abs(diff) > 0.015) {
          this.h[i] = h + diff * Math.min(1, dt * rate);
          if (Math.abs(this.h[i]! - rest) > 0.015) this.wake(i);
        }
      } else if (hasRest && h > rest + 0.015) {
        // Calm water: bleed splash bulges back to rest without injecting volume.
        this.h[i] = h + (rest - h) * Math.min(1, dt * rate);
        if (this.h[i]! > rest + 0.015) this.wake(i);
      }
    }
  }

  /** Wet cells inside a seeded region (spring, rest level, drain) — not stray spray. */
  private protectedWetCells(wet: ReadonlySet<number>): Set<number> {
    const w = this.w;
    const xzN: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const reachableMask = new Set<number>();
    const queue: number[] = [];
    for (const i of this.masked) {
      if (
        !Number.isNaN(this.restDepth[i]!) ||
        this.isSource(i) ||
        this.drain[i]! !== Infinity
      ) {
        reachableMask.add(i);
        queue.push(i);
      }
    }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % w;
      const z = (i - x) / w;
      for (const [dx, dz] of xzN) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= this.d) continue;
        const j = this.idx(nx, nz);
        if (!this.mask[j] || reachableMask.has(j)) continue;
        reachableMask.add(j);
        queue.push(j);
      }
    }
    const protectedCells = new Set<number>();
    for (const i of wet) {
      if (reachableMask.has(i)) protectedCells.add(i);
    }
    return protectedCells;
  }

  /** Dry up tiny disconnected puddles (stray spray, hillside leftovers). */
  private evaporateStranded(dt: number): void {
    const wet = new Set<number>();
    for (const i of this.masked) {
      if (this.h[i]! > MIN_DEPTH) wet.add(i);
    }
    if (wet.size === 0) return;

    const protectedCells = this.protectedWetCells(wet);
    const w = this.w;
    const xzN: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const visited = new Set<number>();

    for (const start of wet) {
      if (visited.has(start) || protectedCells.has(start)) continue;
      const cluster: number[] = [];
      let hasSource = false;
      const queue = [start];
      visited.add(start);
      while (queue.length) {
        const i = queue.pop()!;
        cluster.push(i);
        if (this.isSource(i)) hasSource = true;
        const x = i % w;
        const z = (i - x) / w;
        for (const [dx, dz] of xzN) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= this.d) continue;
          const j = this.idx(nx, nz);
          if (!wet.has(j) || visited.has(j)) continue;
          visited.add(j);
          queue.push(j);
        }
      }
      if (hasSource || cluster.length >= MIN_BODY) continue;
      for (const i of cluster) {
        if (this.isSource(i)) continue;
        let h = this.h[i]! - EVAP_RATE * dt;
        if (h < MIN_DEPTH) h = 0;
        this.h[i] = h;
        if (h <= MIN_DEPTH) {
          this.px[i] = 0;
          this.pz[i] = 0;
          this.active.delete(i);
        }
      }
    }
  }

  /** Move surface particles with sim velocity (continuous positions, never grid-snapped here). */
  private advectSurfaceParticles(dt: number, cells: Iterable<number>): void {
    const drift = 0.55;
    const damp = 0.88;
    const maxOff = 0.49;
    for (const i of cells) {
      if (this.h[i]! <= MIN_DEPTH) {
        this.px[i] = 0;
        this.pz[i] = 0;
        continue;
      }
      const mud = this.mud[i]! === 1;
      const driftMul = mud ? 0.35 : drift;
      const dampMul = mud ? 0.94 : damp;
      const speed = Math.hypot(this.vx[i]!, this.vz[i]!);
      if (speed < VEL_SLEEP) {
        const snap = mud ? 0.82 : 0.65;
        this.px[i] = this.px[i]! * snap;
        this.pz[i] = this.pz[i]! * snap;
        if (Math.abs(this.px[i]!) < 0.015) this.px[i] = 0;
        if (Math.abs(this.pz[i]!) < 0.015) this.pz[i] = 0;
        continue;
      }
      let ox = this.px[i]! + this.vx[i]! * dt * driftMul;
      let oz = this.pz[i]! + this.vz[i]! * dt * driftMul;
      ox *= dampMul;
      oz *= dampMul;
      if (ox > maxOff) ox = maxOff;
      if (ox < -maxOff) ox = -maxOff;
      if (oz > maxOff) oz = maxOff;
      if (oz < -maxOff) oz = -maxOff;
      this.px[i] = ox;
      this.pz[i] = oz;
    }
  }

  private surfaceWorld(i: number): number {
    return this.bed[i]! + Math.max(this.h[i]!, MIN_WATER_LAYER);
  }

  /** One directed pipe's new flux from cell `top` height into neighbour `j`. */
  private pipe(prev: number, top: number, j: number, dt: number, fromI: number): number {
    const topJ = this.bed[j]! + this.obstacle[j]! + this.h[j]!;
    const dHead = top - topJ;
    let f = prev * FLUX_DAMP + dt * GRAVITY * dHead;
    if (this.mud[fromI] || this.mud[j]) f *= 0.28;
    return f > 0 ? f : 0;
  }

  /** One dynamic surface particle per wet column (continuous world x,y,z). */
  forEachSurfaceParticle(cb: (x: number, y: number, z: number) => void): void {
    for (const i of this.masked) {
      if (this.h[i]! <= MIN_DEPTH) continue;
      this.emitSurfaceParticle(i, cb);
    }
  }

  /** Same as {@link forEachSurfaceParticleNear} but only live (river/fountain) columns. */
  forEachLiveNear(
    cx: number,
    cz: number,
    radius: number,
    cb: (x: number, y: number, z: number, colGx: number, colGz: number) => void,
  ): void {
    this.forEachSurfaceParticleNearFiltered(cx, cz, radius, (i) => this.live[i]! === 1, cb);
  }

  /** Ambient columns currently in the active sim (player ripples, etc.). */
  forEachActiveNear(
    cx: number,
    cz: number,
    radius: number,
    cb: (x: number, y: number, z: number, colGx: number, colGz: number) => void,
  ): void {
    this.forEachSurfaceParticleNearFiltered(
      cx,
      cz,
      radius,
      (i) => !this.live[i] && this.active.has(i),
      cb,
    );
  }

  /** Every ambient (static) wet column — call once to bake the lake mesh. */
  forEachAmbient(cb: (x: number, y: number, z: number, colGx: number, colGz: number) => void): void {
    for (const i of this.masked) {
      if (this.live[i] || this.h[i]! <= MIN_DEPTH) continue;
      this.emitSurfaceParticle(i, cb);
    }
  }

  /** Same as {@link forEachSurfaceParticle} but only within `radius` of (cx, cz). */
  forEachSurfaceParticleNear(
    cx: number,
    cz: number,
    radius: number,
    cb: (x: number, y: number, z: number, colGx: number, colGz: number) => void,
  ): void {
    this.forEachSurfaceParticleNearFiltered(cx, cz, radius, () => true, cb);
  }

  private forEachSurfaceParticleNearFiltered(
    cx: number,
    cz: number,
    radius: number,
    keep: (i: number) => boolean,
    cb: (x: number, y: number, z: number, colGx: number, colGz: number) => void,
  ): void {
    const icx = Math.round(cx / VOXEL_UNIT);
    const icz = Math.round(cz / VOXEL_UNIT);
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    const x0 = Math.max(0, icx - r);
    const x1 = Math.min(this.w - 1, icx + r);
    const z0 = Math.max(0, icz - r);
    const z1 = Math.min(this.d - 1, icz + r);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dz = z + 0.5 - cz;
        if (dx * dx + dz * dz > r2) continue;
        const i = this.idx(x, z);
        if (!this.mask[i] || this.h[i]! <= MIN_DEPTH || !keep(i)) continue;
        this.emitSurfaceParticle(i, cb);
      }
    }
  }

  private emitSurfaceParticle(
    i: number,
    cb: (x: number, y: number, z: number, colGx: number, colGz: number) => void,
  ): void {
    const gx = i % this.w;
    const gz = (i - gx) / this.w;
    const x = (gx + 0.5 + this.px[i]!) * VOXEL_UNIT;
    const z = (gz + 0.5 + this.pz[i]!) * VOXEL_UNIT;
    cb(x, this.surfaceWorld(i), z, gx, gz);
  }

  /** @deprecated Prefer {@link forEachSurfaceParticle} — render snaps to grid, not here. */
  forEachSurfaceVoxel(cb: (gx: number, gy: number, gz: number) => void): void {
    this.forEachSurfaceParticle((x, y, z) => {
      const { x: gx, y: gy, z: gz } = snapVoxelCell(x, y, z);
      cb(gx, gy, gz);
    });
  }

  /** Particle landed: add water to the column under snapped world x/z. */
  depositAt(wx: number, wz: number, depth = MIN_WATER_LAYER): boolean {
    const gx = Math.round(wx / VOXEL_UNIT);
    const gz = Math.round(wz / VOXEL_UNIT);
    if (gx < 0 || gz < 0 || gx >= this.w || gz >= this.d) return false;
    const i = this.idx(gx, gz);
    if (!this.mask[i]) return false;
    return this.splashAt(i, depth);
  }

  /** Footstep / spray impact — mud keeps volume; calm water gets a brief bulge that settles. */
  splashAt(i: number, depth = MIN_WATER_LAYER): boolean {
    const lift = depth * 0.25;
    if (this.mud[i]) {
      this.h[i] = Math.max(this.h[i]!, this.h[i]! + lift * 0.55);
    } else if (!Number.isNaN(this.restDepth[i]!)) {
      const rest = this.restDepth[i]!;
      this.h[i] = Math.min(this.h[i]! + lift, rest + 0.12);
    } else {
      this.h[i] = Math.max(this.h[i]!, lift);
    }
    this.wake(i);
    return true;
  }

  /** @deprecated Use {@link forEachSurfaceVoxel} — only the top sheet is rendered. */
  forEachWaterVoxel(cb: (gx: number, gy: number, gz: number) => void): void {
    this.forEachSurfaceVoxel(cb);
  }

  /** Visit every wet cell once (for rendering / debug). */
  forEachWet(cb: (cell: WetCell) => void): void {
    const s = this.scratch;
    for (const i of this.masked) {
      const h = this.h[i]!;
      if (h <= MIN_DEPTH) continue;
      const x = i % this.w;
      s.x = x;
      s.z = (i - x) / this.w;
      s.bed = this.bed[i]!;
      s.depth = h;
      s.surface = s.bed + h;
      s.speed = Math.hypot(this.vx[i]!, this.vz[i]!);
      cb(s);
    }
  }

  activeCount(): number {
    return this.active.size;
  }

  forEachMaskedColumn(cb: (x: number, z: number) => void): void {
    for (const i of this.masked) {
      const x = i % this.w;
      cb(x, (i - x) / this.w);
    }
  }
}
