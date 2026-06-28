// ---------------------------------------------------------------------------
// Displaceable ground cover. A per-column bitmap tracking whether the cover
// (grass / snow / sand / mud) is standing up or laid down, and which way it
// lays. Actors stamp the cells they walk over; cells regrow after a delay.
// The same layer is reused for snow trails, sand scuffs, mud paths, etc.
// ---------------------------------------------------------------------------

import { GRASSY_MATERIALS, type TerrainField, tIdx } from './terrainTypes';

/** state: 0 = standing; 1..4 = laid down toward facing (N,E,S,W) + 1. */
export class SurfaceCover {
  readonly w: number;
  readonly d: number;
  readonly state: Uint8Array;
  /** Only columns whose material grows cover are eligible (1 = eligible). */
  readonly eligible: Uint8Array;
  /** Active (laid) cells -> remaining regrow ticks. */
  private active = new Map<number, number>();
  private regrowTicks: number;
  /** Bumped whenever the visible state changes, so renderers can rebuild lazily. */
  dirty = false;
  private dirtyCells = new Set<number>();

  constructor(field: TerrainField, regrowTicks = 220) {
    this.w = field.w;
    this.d = field.d;
    this.state = new Uint8Array(field.w * field.d);
    this.eligible = new Uint8Array(field.w * field.d);
    this.regrowTicks = regrowTicks;
    for (let i = 0; i < field.material.length; i++) {
      this.eligible[i] = GRASSY_MATERIALS.has(field.material[i]!) ? 1 : 0;
    }
  }

  /** Lay down cover around (x,z) in the given facing (0..3) within radius r. */
  stamp(x: number, z: number, facing: number, r = 1.6): void {
    const dirVal = (facing & 3) + 1;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(this.w - 1, Math.ceil(x + r));
    const z0 = Math.max(0, Math.floor(z - r));
    const z1 = Math.min(this.d - 1, Math.ceil(z + r));
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - x;
        const dz = cz + 0.5 - z;
        if (dx * dx + dz * dz > r2) continue;
        const i = tIdx(cx, cz, this.w);
        if (!this.eligible[i]) continue;
        if (this.state[i] !== dirVal) {
          this.state[i] = dirVal;
          this.markDirty(i);
        }
        this.active.set(i, this.regrowTicks);
      }
    }
  }

  /** Advance regrow timers (call once per world tick). */
  tick(): void {
    if (this.active.size === 0) return;
    for (const [i, t] of this.active) {
      const nt = t - 1;
      if (nt <= 0) {
        this.state[i] = 0;
        this.active.delete(i);
        this.markDirty(i);
      } else {
        this.active.set(i, nt);
      }
    }
  }

  /** Pull the set of cells whose cover visuals changed since the last pull. */
  takeDirtyCells(): number[] {
    if (this.dirtyCells.size === 0) {
      this.dirty = false;
      return [];
    }
    const out = [...this.dirtyCells];
    this.dirtyCells.clear();
    this.dirty = false;
    return out;
  }

  clearDirty(): void {
    this.dirtyCells.clear();
    this.dirty = false;
  }

  private markDirty(i: number): void {
    this.dirty = true;
    this.dirtyCells.add(i);
  }
}
