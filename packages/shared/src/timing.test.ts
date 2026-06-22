import { describe, expect, it } from 'vitest';
import { ticksPerAnimFrame } from './worldSettings';

describe('timing', () => {
  it('computes ticks per anim frame', () => {
    expect(ticksPerAnimFrame({ worldTickRate: 60, animStepRate: 3 })).toBe(20);
    expect(ticksPerAnimFrame({ worldTickRate: 120, animStepRate: 4 })).toBe(30);
  });
});
