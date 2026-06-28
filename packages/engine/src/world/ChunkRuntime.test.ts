import { describe, expect, it } from 'vitest';
import { RUNTIME_CHUNK_SIZE } from './ChunkRuntime';

describe('ChunkRuntime constants', () => {
  it('uses 32-unit runtime chunks', () => {
    expect(RUNTIME_CHUNK_SIZE).toBe(32);
  });
});
