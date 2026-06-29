import { describe, expect, it } from 'vitest';
import type { TerrainField } from '@voxelbound/shared';
import { FluidField } from './FluidField';

function flatField(w: number, d: number, bed = 0): TerrainField {
  const height = new Float32Array(w * d).fill(bed);
  return {
    w,
    d,
    height,
    material: new Uint8Array(w * d),
    walkable: new Uint8Array(w * d),
  };
}

function totalVolume(field: FluidField): number {
  let sum = 0;
  for (const i of field.maskedCells()) sum += field.depthIdx(i);
  return sum;
}

describe('FluidField', () => {
  it('conserves water volume in a closed basin', () => {
    const f = new FluidField(flatField(16, 16));
    const cells = f.seedDisc(8, 8, 5);
    // Pile all the water on one side to create a steep imbalance.
    const left = cells.filter((i) => f.cellX(i) < 8);
    f.fillTo(left, 4);
    f.wakeCells(cells);

    const start = totalVolume(f);
    expect(start).toBeGreaterThan(0);

    for (let n = 0; n < 600; n++) f.step(1 / 60);

    const end = totalVolume(f);
    expect(Math.abs(end - start)).toBeLessThan(0.15);
  });

  it('flows downhill on a sloped bed', () => {
    const w = 24;
    const d = 6;
    const field = flatField(w, d);
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) field.height[z * w + x] = (w - x) * 0.2; // high at x=0
    }
    const f = new FluidField(field);
    const cells = f.seedPath([
      { x: 1, z: 3, half: 1 },
      { x: w - 2, z: 3, half: 1 },
    ]);
    // A spring at the high end should push water all the way downhill.
    f.addSource(2, 3, 8, 20);

    const farDry = cells.find((i) => f.cellX(i) >= w - 4)!;
    expect(f.depthIdx(farDry)).toBe(0);

    for (let n = 0; n < 1200; n++) f.step(1 / 60);

    expect(f.depthIdx(farDry)).toBeGreaterThan(0.05);
  });

  it('settles ripples back toward rest depth', () => {
    const f = new FluidField(flatField(12, 12));
    const cells = f.seedDisc(6, 6, 4);
    f.fillTo(cells, 3);
    f.impulse(6, 6, 20, 0.5);
    for (let n = 0; n < 600; n++) f.step(1 / 60);
    expect(f.activeCount()).toBe(0);
    for (const i of cells) {
      expect(Math.abs(f.depthIdx(i) - 3)).toBeLessThan(0.35);
    }
  });

  it('seeds border ocean columns below sea level', () => {
    const field = flatField(32, 32, 0);
    const f = new FluidField(field);
    const added = f.seedSubmerged(1.5);
    expect(added.length).toBe(32 * 32);
  });

  it('seeds every column below sea level in a partial basin', () => {
    const field = flatField(64, 8);
    for (let i = 0; i < field.height.length; i++) field.height[i] = 4;
    for (let z = 0; z < field.d; z++) {
      for (let x = 40; x < 44; x++) field.height[z * field.w + x] = 0;
    }
    const f = new FluidField(field);
    const added = f.seedSubmerged(1.5);
    expect(added.length).toBe(4 * field.d);
    expect(f.depthIdx(added[0]!)).toBeCloseTo(1.5, 1);
  });

  it('impulse on calm lake settles without permanent depth streaks', () => {
    const f = new FluidField(flatField(12, 12));
    const cells = f.seedDisc(6, 6, 4);
    f.fillTo(cells, 3);
    const rest = f.depthAt(6, 6);
    f.impulse(6, 6, 22, 0.5);
    expect(f.depthAt(6, 6)).toBeGreaterThan(rest);
    for (let n = 0; n < 900; n++) f.step(1 / 60);
    expect(Math.abs(f.depthAt(6, 6) - rest)).toBeLessThan(0.25);
  });

  it('mud holds extra depth longer than water', () => {
    const f = new FluidField(flatField(16, 16));
    f.seedMudDisc(8, 8, 4, 2);
    const rest = f.depthAt(8, 8);
    f.impulse(8, 8, 18, 0.4);
    const peak = f.depthAt(8, 8);
    expect(peak).toBeGreaterThan(rest + 0.05);
    for (let n = 0; n < 120; n++) f.step(1 / 60);
    expect(f.depthAt(8, 8)).toBeGreaterThan(rest + 0.02);
  });

  it('evaporates tiny disconnected puddles', () => {
    const f = new FluidField(flatField(20, 8));
    const lone = f.seedDisc(2, 4, 0.6);
    const pool = f.seedDisc(14, 4, 3);
    f.depositAt(2.5, 4.5, 2);
    f.fillTo(pool, 2);
    for (let n = 0; n < 180; n++) f.step(1 / 60);
    expect(f.depthIdx(lone[0]!)).toBeLessThan(0.05);
    expect(f.depthIdx(pool[0]!)).toBeGreaterThan(0.5);
  });
});

function weightedX(f: FluidField, cells: number[]): number {
  let wsum = 0;
  let xsum = 0;
  for (const i of cells) {
    const h = f.depthIdx(i);
    wsum += h;
    xsum += h * f.cellX(i);
  }
  return wsum > 0 ? xsum / wsum : 0;
}
