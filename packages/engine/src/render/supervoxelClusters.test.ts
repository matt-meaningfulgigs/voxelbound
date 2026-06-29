import { describe, expect, it } from 'vitest';
import { groupFaceClusters, groupXzClusters, supervoxelScale } from '../render/supervoxelClusters';

describe('supervoxelScale', () => {
  it('always returns 1 — clusters are unit cubes, not giant meshes', () => {
    expect(supervoxelScale(1)).toBe(1);
    expect(supervoxelScale(8)).toBe(1);
  });
});

describe('groupFaceClusters', () => {
  it('merges face-adjacent cells into one group', () => {
    const cells = new Map([
      ['0,0,0', { gx: 0, gy: 0, gz: 0 }],
      ['1,0,0', { gx: 1, gy: 0, gz: 0 }],
      ['5,5,5', { gx: 5, gy: 5, gz: 5 }],
    ]);
    const groups = groupFaceClusters(cells);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.cellCount === 2)).toBeDefined();
  });
});

describe('groupXzClusters', () => {
  it('merges XZ neighbors regardless of Y', () => {
    const cells = new Map([
      ['1,5,2', { gx: 1, gy: 5, gz: 2 }],
      ['2,6,2', { gx: 2, gy: 6, gz: 2 }],
    ]);
    const groups = groupXzClusters(cells);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.cellCount).toBe(2);
  });
});
