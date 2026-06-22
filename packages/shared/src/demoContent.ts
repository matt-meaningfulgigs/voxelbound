import type { Archetype, VoxelModel, VoxelEntry } from '@voxelbound/shared';

function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ci: number,
): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) v.push([x, y, z, ci]);
  return v;
}

const PALETTE = {
  skin: '#f4c99a',
  shirt: '#e8453c',
  pants: '#2d4a8a',
  hair: '#3a2a1a',
  shoe: '#1a1a1a',
  grass: '#4a9c3a',
  grassDark: '#2d6b22',
  dirt: '#8b6914',
  ground: '#5a8f3c',
};

function makeHeroFrame(offsetY = 0, legShift = 0): VoxelEntry[] {
  return [
    ...box(6, 0 + offsetY, 4, 9, 1 + offsetY, 5, 4), // L foot
    ...box(6 + legShift, 2 + offsetY, 4, 7 + legShift, 7 + offsetY, 5, 3), // L leg
    ...box(8, 0 + offsetY, 4, 11, 1 + offsetY, 5, 4), // R foot
    ...box(9 - legShift, 2 + offsetY, 4, 10 - legShift, 7 + offsetY, 5, 3), // R leg
    ...box(6, 8 + offsetY, 3, 11, 14 + offsetY, 6, 2), // shirt
    ...box(7, 15 + offsetY, 4, 10, 18 + offsetY, 5, 0), // head
    ...box(6, 17 + offsetY, 3, 11, 19 + offsetY, 6, 1), // hair
    ...box(5, 13 + offsetY, 4, 5, 16 + offsetY, 5, 2), // L arm
    ...box(12, 13 + offsetY, 4, 12, 16 + offsetY, 5, 2), // R arm
  ];
}

export const heroModel: VoxelModel = {
  id: 'hero',
  kind: 'character',
  bounds: [16, 24, 12],
  palette: Object.values(PALETTE),
  pivot: [8, 0, 6],
  animations: {
    idle: { frames: ['idle_0', 'idle_1'], ticksPerFrame: null, loop: 'loop' },
    walk: { frames: ['walk_0', 'walk_1', 'walk_2'], ticksPerFrame: null, loop: 'loop' },
    talk: { frames: ['talk_0', 'talk_1'], ticksPerFrame: null, loop: 'loop' },
  },
  frames: {
    idle_0: makeHeroFrame(0, 0),
    idle_1: makeHeroFrame(0, 0).map(([x, y, z, c]) =>
      c === 2 ? ([x, y, z, c] as VoxelEntry) : ([x, y + (x === 8 ? 1 : 0), z, c] as VoxelEntry),
    ),
    walk_0: makeHeroFrame(0, 1),
    walk_1: makeHeroFrame(0, 0),
    walk_2: makeHeroFrame(0, -1),
    talk_0: makeHeroFrame(0, 0),
    talk_1: [
      ...makeHeroFrame(0, 0),
      ...box(12, 14, 3, 13, 15, 6, 0),
    ],
  },
};

function makeGroundTile(): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++)
      v.push([x, 0, z, 0], [x, 1, z, 1]);
  return v;
}

export const groundTileModel: VoxelModel = {
  id: 'ground_tile',
  kind: 'tile',
  bounds: [16, 2, 16],
  palette: [PALETTE.ground, PALETTE.dirt],
  pivot: [8, 0, 8],
  animations: {},
  frames: { default: makeGroundTile() },
};

function makeGrassBlade(tilt: number): VoxelEntry[] {
  const v: VoxelEntry[] = [[0, 0, 0, 0], [0, 1, 0, 0], [0, 2, 0, 1]];
  if (tilt > 0) v.push([1, 2, 0, 1], [1, 3, 0, 1]);
  if (tilt < 0) v.push([-1, 2, 0, 1], [-1, 3, 0, 1]);
  return v;
}

export const grassTileModel: VoxelModel = {
  id: 'grass_tile',
  kind: 'interactive',
  bounds: [2, 4, 2],
  palette: [PALETTE.grass, PALETTE.grassDark],
  pivot: [0, 0, 0],
  behavior: 'displace',
  animations: {
    sway: { frames: ['sway_0', 'sway_1', 'sway_2'], ticksPerFrame: null, loop: 'loop' },
  },
  frames: {
    sway_0: makeGrassBlade(0),
    sway_1: makeGrassBlade(1),
    sway_2: makeGrassBlade(-1),
  },
};

export const townspersonArchetype: Archetype = {
  id: 'townsperson',
  kind: 'living',
  defaultState: 'idle',
  npcBrain: 'wander',
  states: {
    idle: { clip: 'idle' },
    idle_random: {
      clip: 'idle',
      pool: [{ clip: 'idle', weight: 1 }],
    },
    walk: { clip: 'walk' },
    talk: { clip: 'talk' },
    interact: { clip: 'talk' },
  },
};

export const allModels = [heroModel, groundTileModel, grassTileModel];
export const allArchetypes = [townspersonArchetype];
