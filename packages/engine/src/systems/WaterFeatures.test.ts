import { describe, expect, it } from 'vitest';
import { classifyLiquidClusters } from './WaterFeatures';

function cell(gx: number, gy: number, gz: number, bulk: number, spray = 0, liquid = false) {
  return { gx, gy, gz, bulk, spray, liquid };
}

describe('classifyLiquidClusters', () => {
  it('marks isolated bulk cells as splash', () => {
    const cells = new Map<string, ReturnType<typeof cell>>();
    for (const gx of [1, 3, 5, 7, 9]) cells.set(`${gx},0,0`, cell(gx, 0, 0, 1));
    classifyLiquidClusters(cells);
    for (const c of cells.values()) expect(c.liquid).toBe(false);
  });

  it('merges adjacent bulk into liquid; gaps stay splash', () => {
    const cells = new Map<string, ReturnType<typeof cell>>();
    for (const gx of [1, 2, 5, 7, 8]) cells.set(`${gx},0,0`, cell(gx, 0, 0, 1));
    classifyLiquidClusters(cells);
    expect(cells.get('1,0,0')!.liquid).toBe(true);
    expect(cells.get('2,0,0')!.liquid).toBe(true);
    expect(cells.get('5,0,0')!.liquid).toBe(false);
    expect(cells.get('7,0,0')!.liquid).toBe(true);
    expect(cells.get('8,0,0')!.liquid).toBe(true);
  });

  it('merges sloped bulk columns that differ in Y', () => {
    const cells = new Map<string, ReturnType<typeof cell>>([
      ['10,5,20', cell(10, 5, 20, 1)],
      ['11,6,20', cell(11, 6, 20, 1)],
      ['12,7,20', cell(12, 7, 20, 1)],
    ]);
    classifyLiquidClusters(cells);
    expect(cells.get('10,5,20')!.liquid).toBe(true);
    expect(cells.get('11,6,20')!.liquid).toBe(true);
    expect(cells.get('12,7,20')!.liquid).toBe(true);
  });

  it('keeps airborne spray white even beside bulk liquid', () => {
    const cells = new Map<string, ReturnType<typeof cell>>([
      ['1,0,0', cell(1, 0, 0, 1)],
      ['2,0,0', cell(2, 0, 0, 1)],
      ['3,5,0', cell(3, 5, 0, 0, 1)],
    ]);
    classifyLiquidClusters(cells);
    expect(cells.get('3,5,0')!.liquid).toBe(false);
  });

  it('treats stacked bulk in one cell as liquid', () => {
    const cells = new Map([['3,0,0', cell(3, 0, 0, 3)]]);
    classifyLiquidClusters(cells);
    expect(cells.get('3,0,0')!.liquid).toBe(true);
  });
});
