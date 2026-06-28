import { describe, expect, it } from 'vitest';
import { dominantVoxelCell, dominantVoxelIndex, snapVoxelIndex, updateDominantCell, VOXEL_UNIT } from './voxelUnit';

describe('snapVoxelIndex', () => {
  it('rounds world coordinates to the nearest grid index', () => {
    expect(snapVoxelIndex(11.4 * VOXEL_UNIT)).toBe(11);
    expect(snapVoxelIndex(11.6 * VOXEL_UNIT)).toBe(12);
    expect(snapVoxelIndex(11.5 * VOXEL_UNIT)).toBe(12);
  });
});

describe('dominantVoxelIndex', () => {
  it('picks the cell the point occupies more of', () => {
    expect(dominantVoxelIndex(11.4 * VOXEL_UNIT)).toBe(11);
    expect(dominantVoxelIndex(11.6 * VOXEL_UNIT)).toBe(12);
  });

  it('uses previous cell at exact mid-boundary to avoid flicker', () => {
    const mid = 11.5 * VOXEL_UNIT;
    expect(dominantVoxelIndex(mid, 11)).toBe(11);
    expect(dominantVoxelIndex(mid, 12)).toBe(12);
  });
});

describe('dominantVoxelCell', () => {
  it('maps each axis independently', () => {
    expect(dominantVoxelCell(11.4, 5.6, 3.2)).toEqual({ x: 11, y: 6, z: 3 });
  });
});

describe('updateDominantCell', () => {
  it('reports cell changes for snap on/off tracking', () => {
    const render = { x: 11, y: 5, z: 3 };
    expect(updateDominantCell(11.4 * VOXEL_UNIT, 5.2 * VOXEL_UNIT, 3.1 * VOXEL_UNIT, render)).toBe(false);
    expect(render).toEqual({ x: 11, y: 5, z: 3 });
    expect(updateDominantCell(11.6 * VOXEL_UNIT, 5.2 * VOXEL_UNIT, 3.1 * VOXEL_UNIT, render)).toBe(true);
    expect(render.x).toBe(12);
  });
});
