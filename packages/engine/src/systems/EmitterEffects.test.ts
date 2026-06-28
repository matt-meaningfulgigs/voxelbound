import { describe, expect, it } from 'vitest';
import { classifySmokeBillows, classifyFireClusters, fireClusterScale, buildEmitterRegions } from './EmitterEffects';
import type { VisualCell } from './EmitterEffects';
import type { EmitterVoxel } from '@voxelbound/shared';

function cell(gx: number, gy: number, gz: number, weight = 1, ageSum = 0.5): VisualCell {
  return { gx, gy, gz, weight, ageSum, heatSum: 0.8, billow: false, clusterMass: 1 };
}

describe('classifySmokeBillows', () => {
  it('merges cells within radius 2 into billows', () => {
    const cells = new Map<string, VisualCell>();
    cells.set('0,0,0', cell(0, 0, 0));
    cells.set('2,0,0', cell(2, 0, 0));
    cells.set('0,2,0', cell(0, 2, 0));
    classifySmokeBillows(cells, 2);
    expect([...cells.values()].every((c) => c.billow)).toBe(true);
  });

  it('leaves isolated wisps unconnected', () => {
    const cells = new Map<string, VisualCell>();
    cells.set('0,0,0', cell(0, 0, 0));
    cells.set('10,10,10', cell(10, 10, 10));
    classifySmokeBillows(cells, 2);
    expect(cells.get('0,0,0')!.billow).toBe(false);
    expect(cells.get('10,10,10')!.billow).toBe(false);
  });
});

describe('classifyFireClusters', () => {
  it('marks adjacent fire cells as clustered with mass', () => {
    const cells = new Map<string, VisualCell>();
    cells.set('0,0,0', cell(0, 0, 0));
    cells.set('1,0,0', cell(1, 0, 0));
    classifyFireClusters(cells);
    expect(cells.get('0,0,0')!.billow).toBe(true);
    expect(cells.get('1,0,0')!.clusterMass).toBeGreaterThan(2);
  });
});

describe('fireClusterScale', () => {
  it('grows with cluster mass', () => {
    expect(fireClusterScale(1, 1)).toBeLessThan(fireClusterScale(40, 4));
    expect(fireClusterScale(80, 6)).toBeGreaterThan(1.5);
  });
});

describe('buildEmitterRegions', () => {
  it('aggregates adjacent fire voxels into fewer regions', () => {
    const sources: EmitterVoxel[] = [];
    for (let i = 0; i < 12; i++) {
      sources.push({ x: 10 + (i % 3), y: 5, z: 20 + Math.floor(i / 3), kind: 'fire' });
    }
    const regions = buildEmitterRegions(sources);
    expect(regions.length).toBeLessThan(sources.length);
    expect(regions[0]!.strength).toBeGreaterThan(0);
  });
});
