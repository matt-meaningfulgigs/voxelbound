import type { Archetype, VoxelModel, VoxelEntry } from './voxelModel';
import { Rng, hashSeed } from './game/worldgen/noise';
import { burningEffigyModel } from './burningEffigy';

/** Fill an inclusive voxel box with a palette index. */
export function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ci: number,
): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
  for (let x = ax; x <= bx; x++)
    for (let y = ay; y <= by; y++)
      for (let z = az; z <= bz; z++) v.push([x, y, z, ci]);
  return v;
}

// ---------------------------------------------------------------------------
// Characters (hero + villagers share geometry, vary palette)
// Palette index map: 0=skin 1=hair 2=shirt 3=pants 4=shoe
// ---------------------------------------------------------------------------

function heroFrame(legShift = 0, armRaise = 0): VoxelEntry[] {
  return [
    ...box(6, 0, 4, 9, 1, 5, 4), // L foot
    ...box(6 + legShift, 2, 4, 7 + legShift, 7, 5, 3), // L leg
    ...box(8, 0, 4, 11, 1, 5, 4), // R foot
    ...box(9 - legShift, 2, 4, 10 - legShift, 7, 5, 3), // R leg
    ...box(6, 8, 3, 11, 14, 6, 2), // torso / shirt
    ...box(7, 15, 4, 10, 18, 5, 0), // head
    ...box(6, 17, 3, 11, 19, 6, 1), // hair
    ...box(5, 13 + armRaise, 4, 5, 16 + armRaise, 5, 2), // L arm
    ...box(12, 13, 4, 12, 16, 5, 2), // R arm
  ];
}

const HERO_FRAMES: Record<string, VoxelEntry[]> = {
  idle_0: heroFrame(0, 0),
  idle_1: heroFrame(0, 0).map(
    ([x, y, z, c]) =>
      (c === 0 || c === 1 ? [x, y + 1, z, c] : [x, y, z, c]) as VoxelEntry,
  ), // subtle head bob
  walk_0: heroFrame(1, 0),
  walk_1: heroFrame(0, 0),
  walk_2: heroFrame(-1, 0),
  talk_0: heroFrame(0, 0),
  talk_1: heroFrame(0, 1),
};

const CHARACTER_ANIMS = {
  idle: { frames: ['idle_0', 'idle_1'], ticksPerFrame: null, loop: 'loop' as const },
  walk: { frames: ['walk_0', 'walk_1', 'walk_2', 'walk_1'], ticksPerFrame: null, loop: 'loop' as const },
  talk: { frames: ['talk_0', 'talk_1'], ticksPerFrame: null, loop: 'loop' as const },
};

function makeCharacter(id: string, palette: string[]): VoxelModel {
  return {
    id,
    kind: 'character',
    bounds: [18, 24, 12],
    palette,
    pivot: [8.5, 0, 4.5], // footprint center → clean rotation + camera centering
    animations: CHARACTER_ANIMS,
    frames: HERO_FRAMES,
  };
}

export const heroModel = makeCharacter('hero', [
  '#f4c99a', // skin
  '#5a3a1a', // hair
  '#e8453c', // shirt (red)
  '#2d4a8a', // pants (blue)
  '#1a1a1a', // shoe
]);

export const villagerModels: VoxelModel[] = [
  makeCharacter('villager_green', ['#e8b890', '#2a1a0a', '#3a8c4a', '#6b4a2a', '#222']),
  makeCharacter('villager_purple', ['#f4c99a', '#1a1a2a', '#7a4ab0', '#3a3a4a', '#111']),
  makeCharacter('villager_teal', ['#d9a878', '#3a2a1a', '#2a9c9c', '#404048', '#1a1a1a']),
  makeCharacter('villager_orange', ['#f4c99a', '#6a3a1a', '#e88a2a', '#5a4a3a', '#222']),
  makeCharacter('villager_pink', ['#f6d0b0', '#7a4a2a', '#e87aa8', '#6a4a5a', '#2a1a1a']),
  makeCharacter('villager_gray', ['#e8b890', '#888888', '#6a6a72', '#3a3a40', '#111']),
];

// ---------------------------------------------------------------------------
// Terrain tiles (kept for studio/asset compatibility)
// ---------------------------------------------------------------------------

export const groundTileModel: VoxelModel = {
  id: 'ground_tile',
  kind: 'tile',
  bounds: [16, 2, 16],
  palette: ['#5a8f3c', '#8b6914'],
  pivot: [8, 0, 8],
  animations: {},
  frames: {
    default: (() => {
      const v: VoxelEntry[] = [];
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) v.push([x, 0, z, 0], [x, 1, z, 1]);
      return v;
    })(),
  },
};

function grassTuft(tilt: number): VoxelEntry[] {
  const v: VoxelEntry[] = [
    [0, 0, 0, 0], [0, 1, 0, 0], [0, 2, 0, 1],
    [1, 0, 1, 0], [1, 1, 1, 1],
    [-1, 0, -1, 0], [-1, 1, -1, 1],
  ];
  if (tilt > 0) v.push([1, 2, 0, 1], [1, 3, 0, 1], [2, 2, 1, 1]);
  if (tilt < 0) v.push([-1, 2, 0, 1], [-1, 3, 0, 1], [-2, 2, -1, 1]);
  return v;
}

export const grassTileModel: VoxelModel = {
  id: 'grass_tile',
  kind: 'interactive',
  bounds: [4, 4, 4],
  palette: ['#4a9c3a', '#2d6b22'],
  pivot: [0, 0, 0],
  behavior: 'displace',
  animations: {
    sway: { frames: ['sway_0', 'sway_1', 'sway_2'], ticksPerFrame: null, loop: 'loop' },
  },
  frames: {
    sway_0: grassTuft(0),
    sway_1: grassTuft(1),
    sway_2: grassTuft(-1),
  },
};

// ---------------------------------------------------------------------------
// Trees — parametric & randomized. Frames are centered on (0,0) so the trunk
// sits at the model origin; pivot is [0,0,0]. A human is ~20 voxels tall, so a
// "giant" (~58 tall) reads as roughly 3x a character. Crowns lean for sway.
// Palette: 0 bark · 1 leafMain · 2 leafDark · 3 leafLight
// ---------------------------------------------------------------------------

interface BroadleafOpts {
  trunkH: number;
  trunkR: number;
  rx: number;
  ry: number;
  sway: number;
}

interface LeafCluster {
  x: number;
  y: number;
  z: number;
  r: number;
}

function leafBlob(c: LeafCluster, lean: number, top: number, out: VoxelEntry[]): void {
  const shift = Math.round(lean * (c.y / top));
  const r = c.r;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        const e = (dx * dx + dy * dy + dz * dz) / (r * r + r);
        if (e > 1.05) continue;
        let ci = 1;
        if (e > 0.62 || dy < -r * 0.3) ci = 2; // outer + underside darker
        else if (dy > r * 0.25 && e < 0.4) ci = 3; // sunlit highlights
        out.push([Math.round(c.x) + shift + dx, Math.round(c.y) + dy, Math.round(c.z) + dz, ci]);
      }
}

function lineBark(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  out: VoxelEntry[],
): void {
  const steps = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const z = Math.round(z0 + (z1 - z0) * t);
    out.push([x, y, z, 0]);
    out.push([x + 1, y, z, 0]); // a little thickness
  }
}

/**
 * Procedural broadleaf tree: a flared trunk that forks into several branches,
 * each tipped with a leaf cluster, plus a crown cluster — an organic canopy
 * instead of a single "lollipop" sphere. Shape is seeded for stability.
 */
function broadleafFrames(o: BroadleafOpts, rng: Rng): Record<string, VoxelEntry[]> {
  const trunk: VoxelEntry[] = [];
  for (let y = 0; y <= o.trunkH; y++) {
    const r = y < 2 ? o.trunkR + 1 : o.trunkR; // flared base
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++)
        if (x * x + z * z <= r * r + r) trunk.push([x, y, z, 0]);
  }

  const branchBark: VoxelEntry[] = [];
  const clusters: LeafCluster[] = [];
  const nBranches = 3 + rng.int(0, 2);
  for (let i = 0; i < nBranches; i++) {
    const ang = (i / nBranches) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const len = o.rx * 0.7 + rng.next() * o.rx * 0.7;
    const h0 = o.trunkH * (0.55 + rng.next() * 0.4);
    const ex = Math.cos(ang) * len;
    const ez = Math.sin(ang) * len;
    const ey = h0 + len * (0.5 + rng.next() * 0.4);
    lineBark(0, h0, 0, ex, ey, ez, branchBark);
    clusters.push({ x: ex, y: ey, z: ez, r: Math.max(2, o.ry * 0.5 + rng.range(-0.5, 1.5)) });
  }
  // crown on top of the trunk
  clusters.push({ x: 0, y: o.trunkH + o.ry * 0.6, z: 0, r: o.ry * 0.8 });

  const bark = [...trunk, ...branchBark];
  const top = o.trunkH + o.ry * 2;
  const build = (lean: number): VoxelEntry[] => {
    const leaves: VoxelEntry[] = [];
    for (const c of clusters) leafBlob(c, lean, top, leaves);
    return [...bark, ...leaves];
  };

  return {
    default: build(0),
    sway_0: build(0),
    sway_1: build(o.sway),
    sway_2: build(-o.sway),
  };
}

const LEAF_PALETTES: string[][] = [
  ['#6b4a2a', '#3f9c3a', '#2c6e28', '#63c24a'],
  ['#5f4327', '#4aa83f', '#327a2c', '#74cf57'],
  ['#6b4a2a', '#5fae3a', '#3d7e2a', '#8fd96a'],
  ['#574021', '#2f8c4a', '#206b38', '#49b56a'],
];

interface TreeTier {
  tag: string;
  trunkH: number;
  trunkR: number;
  rx: number;
  ry: number;
  sway: number;
  variants: number;
}

const TREE_TIERS: TreeTier[] = [
  { tag: 'sapling', trunkH: 7, trunkR: 1, rx: 4, ry: 4, sway: 1, variants: 1 },
  { tag: 'medium', trunkH: 14, trunkR: 2, rx: 6, ry: 6, sway: 1, variants: 2 },
  { tag: 'large', trunkH: 22, trunkR: 2, rx: 8, ry: 7, sway: 2, variants: 2 },
  { tag: 'giant', trunkH: 36, trunkR: 3, rx: 12, ry: 11, sway: 2, variants: 2 },
];

function jitter(rng: Rng, base: number, amt: number): number {
  return Math.max(1, base + Math.round(rng.range(-amt, amt)));
}

export const treeModels: VoxelModel[] = [];
TREE_TIERS.forEach((tier, ti) => {
  for (let k = 0; k < tier.variants; k++) {
    const rng = new Rng(hashSeed(0x7be3, ti, k));
    const pal = LEAF_PALETTES[(ti + k) % LEAF_PALETTES.length]!;
    const o: BroadleafOpts = {
      trunkH: jitter(rng, tier.trunkH, tier.trunkH * 0.12),
      trunkR: tier.trunkR,
      rx: jitter(rng, tier.rx, 1),
      ry: jitter(rng, tier.ry, 1),
      sway: tier.sway,
    };
    const reach = o.rx + Math.round(o.ry);
    treeModels.push({
      id: `tree_${tier.tag}_${k}`,
      kind: 'prop',
      bounds: [reach * 2 + 4, o.trunkH + o.ry * 2 + 4, reach * 2 + 4],
      palette: pal,
      pivot: [0, 0, 0],
      animations: {
        sway: { frames: ['sway_0', 'sway_1', 'sway_2'], ticksPerFrame: null, loop: 'loop' },
      },
      frames: broadleafFrames(o, rng),
    });
  }
});

// Conifers — tall tiered pines
interface PineOpts {
  trunkH: number;
  crownH: number;
  baseR: number;
  sway: number;
}

function coniferFrames(o: PineOpts): Record<string, VoxelEntry[]> {
  const trunk: VoxelEntry[] = [];
  for (let y = 0; y <= o.trunkH; y++) {
    const r = y < 2 ? 2 : 1;
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++)
        if (x * x + z * z <= r * r + r) trunk.push([x, y, z, 0]);
  }
  const top = o.trunkH + o.crownH;
  const crown = (lean: number): VoxelEntry[] => {
    const v: VoxelEntry[] = [];
    for (let y = o.trunkH - 3; y <= top; y++) {
      const f = (top - y) / o.crownH; // 0 at tip, 1 at base
      const rad = Math.max(0, Math.round(o.baseR * f));
      const shift = Math.round((1 - f) * lean);
      for (let x = -rad; x <= rad; x++)
        for (let z = -rad; z <= rad; z++) {
          if (x * x + z * z > rad * rad + rad) continue;
          const ci = x * x + z * z >= (rad - 1) * (rad - 1) ? 2 : 1;
          v.push([x + shift, y, z, ci]);
        }
    }
    v.push([0, top + 1, 0, 1], [0, top + 2, 0, 1]);
    return [...trunk, ...v];
  };
  return {
    default: crown(0),
    sway_0: crown(0),
    sway_1: crown(o.sway),
    sway_2: crown(-o.sway),
  };
}

const PINE_PAL = ['#5a3f22', '#2f7a3a', '#1f5a28'];

export const pineModels: VoxelModel[] = (
  [
    { tag: 'med', trunkH: 10, crownH: 22, baseR: 7, sway: 1 },
    { tag: 'tall', trunkH: 16, crownH: 38, baseR: 10, sway: 1 },
  ] as Array<PineOpts & { tag: string }>
).map((t) => ({
  id: `pine_${t.tag}`,
  kind: 'prop',
  bounds: [t.baseR * 2 + 2, t.trunkH + t.crownH + 4, t.baseR * 2 + 2],
  palette: PINE_PAL,
  pivot: [0, 0, 0],
  animations: {
    sway: { frames: ['sway_0', 'sway_1', 'sway_2'], ticksPerFrame: null, loop: 'loop' },
  },
  frames: coniferFrames(t),
}));

export const treeModelIds = treeModels.map((m) => m.id);
export const pineModelIds = pineModels.map((m) => m.id);

// ---------------------------------------------------------------------------
// Houses — full scale (a person is ~20 tall; these are ~46 tall, 38x34 wide).
// Frames are 0..W / 0..D; pivot is the footprint center, so the building
// centers on its placement point. Gable roof, overhanging eaves, chimney.
// Palette: 0 wall · 1 roof · 2 door · 3 window · 4 trim · 5 stone · 6 roofDark
// ---------------------------------------------------------------------------

function makeHouse(W: number, D: number, wallH: number, roofH: number): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  const cx = Math.floor(W / 2);
  const doorX0 = cx - 4;
  const doorX1 = cx + 3;
  const doorY1 = 16;
  const winY0 = 17;
  const winY1 = 22;

  const isDoor = (x: number, y: number, z: number): boolean =>
    z === D - 1 && x >= doorX0 && x <= doorX1 && y >= 2 && y <= doorY1;

  const isWin = (x: number, y: number, z: number): boolean => {
    if (y < winY0 || y > winY1) return false;
    const sideX = (x >= 3 && x <= 7) || (x >= W - 8 && x <= W - 4);
    const sideZ = (z >= 7 && z <= 11) || (z >= D - 12 && z <= D - 8);
    if ((z === 0 || z === D - 1) && sideX) return true;
    if ((x === 0 || x === W - 1) && sideZ) return true;
    return false;
  };

  // stone foundation
  v.push(...box(0, 0, 0, W - 1, 1, D - 1, 5));

  // wall shell with carved openings
  for (let y = 2; y <= wallH; y++)
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++) {
        if (!(x === 0 || x === W - 1 || z === 0 || z === D - 1)) continue;
        if (isDoor(x, y, z)) {
          v.push([x, y, z, 2]);
        } else if (isWin(x, y, z)) {
          v.push([x, y, z, 3]);
        } else {
          v.push([x, y, z, 0]);
        }
      }

  // corner posts + eave trim
  for (let y = 2; y <= wallH; y++) {
    v.push([0, y, 0, 4], [W - 1, y, 0, 4], [0, y, D - 1, 4], [W - 1, y, D - 1, 4]);
  }
  v.push(...box(-1, wallH + 1, -1, W, wallH + 1, D, 4));

  // gable roof — ridge runs along X, slopes toward +z / -z eaves
  const czf = (D - 1) / 2;
  const topAt = (z: number): number =>
    Math.round(wallH + roofH * (1 - Math.abs(z - czf) / czf));
  for (let z = 0; z < D; z++) {
    const top = topAt(z);
    for (let y = wallH + 1; y < top; y++) {
      v.push([0, y, z, 0], [W - 1, y, z, 0]); // gable triangle ends
    }
    for (let x = -1; x <= W; x++) {
      v.push([x, top, z, 1], [x, top - 1, z, 6]); // shingles + underlayer
    }
  }

  // chimney
  const chX = W - 9;
  for (let y = wallH; y <= wallH + roofH + 3; y++) v.push(...box(chX, y, 5, chX + 2, y, 7, 5));

  return v;
}

function houseModel(id: string, palette: string[]): VoxelModel {
  const W = 38;
  const D = 34;
  const wallH = 26;
  const roofH = 16;
  return {
    id,
    kind: 'prop',
    bounds: [W, wallH + roofH + 6, D],
    palette,
    pivot: [W / 2, 0, D / 2],
    animations: {},
    frames: { default: makeHouse(W, D, wallH, roofH) },
  };
}

export const houseModels: VoxelModel[] = [
  houseModel('house_red', ['#e8d8b8', '#c0392b', '#5a3a1a', '#bfe8f0', '#a89878', '#8a8076', '#9c2b20']),
  houseModel('house_blue', ['#e6ead0', '#3a5aa8', '#5a3a1a', '#cdeede', '#b0b49a', '#86827a', '#2e4a90']),
  houseModel('house_green', ['#f0e6c8', '#3a8c4a', '#5a3a1a', '#bfe6f0', '#cabf98', '#8a8076', '#2e7038']),
  houseModel('house_purple', ['#ece0d8', '#7a4ab0', '#4a2a1a', '#e0d2f0', '#bbab9e', '#86827a', '#643a96']),
];

// ---------------------------------------------------------------------------
// Fountain
// Palette: 0=stone 1=stoneDark 2=water
// ---------------------------------------------------------------------------

export const fountainModel: VoxelModel = {
  id: 'fountain',
  kind: 'prop',
  bounds: [16, 8, 16],
  palette: ['#b8b4ac', '#86827a', '#4aa6e0'],
  paletteEmitters: ['solid', 'solid', 'water'],
  pivot: [7, 0, 7],
  animations: {},
  frames: {
    default: [
      ...box(0, 0, 0, 14, 2, 1, 0),
      ...box(0, 0, 13, 14, 2, 14, 0),
      ...box(0, 0, 0, 1, 2, 14, 0),
      ...box(13, 0, 0, 14, 2, 14, 0),
      ...box(2, 0, 2, 12, 0, 12, 1),
      ...box(2, 1, 2, 12, 1, 12, 2), // water pool
      ...box(6, 1, 6, 8, 6, 8, 0), // center pillar
      ...box(5, 6, 5, 9, 7, 9, 2), // top spout water
    ],
  },
};

// ---------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------

function makeFlower(): VoxelEntry[] {
  return [
    [0, 0, 0, 0], [0, 1, 0, 0], [0, 2, 0, 0],
    [0, 3, 0, 1], [-1, 3, 0, 1], [1, 3, 0, 1],
    [0, 3, -1, 1], [0, 3, 1, 1], [0, 4, 0, 1],
  ];
}

function flowerModel(id: string, bloom: string): VoxelModel {
  return {
    id,
    kind: 'prop',
    bounds: [3, 5, 3],
    palette: ['#3a8c3a', bloom],
    pivot: [0, 0, 0],
    animations: {},
    frames: { default: makeFlower() },
  };
}

export const flowerModels: VoxelModel[] = [
  flowerModel('flower_red', '#e84a4a'),
  flowerModel('flower_yellow', '#f4d23a'),
  flowerModel('flower_purple', '#b06ad0'),
  flowerModel('flower_white', '#f0f0f0'),
];

function blob(half: number, height: number, c0: number, c1: number): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  for (let y = 0; y <= height; y++) {
    const r = half - Math.floor((y / (height + 1)) * half);
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.abs(x) + Math.abs(z) > r + 1) continue;
        v.push([x, y, z, y === 0 ? c1 : c0]);
      }
  }
  return v;
}

export const bushModel: VoxelModel = {
  id: 'bush',
  kind: 'prop',
  bounds: [7, 4, 7],
  palette: ['#3f9c3a', '#2c6e28'],
  pivot: [0, 0, 0],
  animations: {},
  frames: { default: blob(3, 3, 0, 1) },
};

export const rockModel: VoxelModel = {
  id: 'rock',
  kind: 'prop',
  bounds: [6, 3, 6],
  palette: ['#9a958e', '#6f6a63'],
  pivot: [0, 0, 0],
  animations: {},
  frames: { default: blob(2, 2, 0, 1) },
};

export const fenceModel: VoxelModel = {
  id: 'fence',
  kind: 'prop',
  bounds: [8, 5, 2],
  palette: ['#8a6a3a', '#6a4a2a'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(0, 0, 0, 1, 4, 1, 0),
      ...box(7, 0, 0, 8, 4, 1, 0),
      ...box(0, 2, 0, 8, 2, 0, 1),
      ...box(0, 4, 0, 8, 4, 0, 1),
    ],
  },
};

export const signModel: VoxelModel = {
  id: 'sign',
  kind: 'prop',
  bounds: [6, 7, 2],
  palette: ['#6a4a2a', '#c8a868'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(0, 0, 0, 0, 5, 0, 0),
      ...box(-2, 4, 0, 2, 6, 0, 1),
    ],
  },
};

export const lampModel: VoxelModel = {
  id: 'lamp',
  kind: 'prop',
  bounds: [4, 11, 4],
  palette: ['#3a3a42', '#ffe9a8'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(0, 0, 0, 0, 8, 0, 0),
      ...box(-1, 9, -1, 1, 10, 1, 1),
      ...box(-1, 8, -1, 1, 8, 1, 0),
    ],
  },
};

// ---------------------------------------------------------------------------
// Stackable clutter props (crates, barrels, cans, dumpsters)
// ---------------------------------------------------------------------------

export const crateModel: VoxelModel = {
  id: 'crate',
  kind: 'prop',
  bounds: [5, 5, 5],
  palette: ['#a9763e', '#6f4824', '#c9a26a'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(-2, 0, -2, 2, 4, 2, 0),
      ...box(-2, 0, -2, -2, 4, 2, 1),
      ...box(2, 0, -2, 2, 4, 2, 1),
      ...box(-2, 0, -2, 2, 4, -2, 1),
      ...box(-2, 0, 2, 2, 4, 2, 1),
      ...box(-2, 2, -2, 2, 2, 2, 1),
      ...box(-2, 4, -2, 2, 4, 2, 2),
    ],
  },
};

export const barrelModel: VoxelModel = {
  id: 'barrel',
  kind: 'prop',
  bounds: [5, 6, 5],
  palette: ['#8a5a2a', '#4f3216', '#b0804a'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(-1, 0, -2, 1, 5, 2, 0),
      ...box(-2, 0, -1, 2, 5, 1, 0),
      ...box(-2, 1, -1, 2, 1, 1, 1),
      ...box(-1, 1, -2, 1, 1, 2, 1),
      ...box(-2, 4, -1, 2, 4, 1, 1),
      ...box(-1, 4, -2, 1, 4, 2, 1),
      ...box(-1, 5, -1, 1, 5, 1, 2),
    ],
  },
};

export const trashcanModel: VoxelModel = {
  id: 'trashcan',
  kind: 'prop',
  bounds: [5, 6, 5],
  palette: ['#9aa0a8', '#666c74', '#bcc0c8'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(-1, 0, -2, 1, 4, 2, 0),
      ...box(-2, 0, -1, 2, 4, 1, 0),
      ...box(-2, 1, -1, 2, 1, 1, 1),
      ...box(-2, 3, -1, 2, 3, 1, 1),
      ...box(-2, 5, -2, 2, 5, 2, 2),
      ...box(-1, 6, -1, 1, 6, 1, 1),
    ],
  },
};

export const dumpsterModel: VoxelModel = {
  id: 'dumpster',
  kind: 'prop',
  bounds: [11, 6, 7],
  palette: ['#2f7e44', '#1d4f2c', '#3a3f44'],
  pivot: [0, 0, 0],
  animations: {},
  frames: {
    default: [
      ...box(-5, 1, -3, 5, 4, 3, 0),
      ...box(-5, 0, -3, -4, 4, 3, 1),
      ...box(4, 0, -3, 5, 4, 3, 1),
      ...box(-5, 0, 0, 5, 1, 0, 2),
      ...box(-5, 5, -3, 5, 5, 3, 2),
      ...box(-5, 0, -3, -5, 1, -2, 2),
      ...box(5, 0, 2, 5, 1, 3, 2),
    ],
  },
};

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enemy battle models (idle + attack frames)
// ---------------------------------------------------------------------------

function makeEnemy(
  id: string,
  palette: string[],
  bounds: [number, number, number],
  idle: VoxelEntry[],
  attack: VoxelEntry[],
  pivot: [number, number, number],
): VoxelModel {
  return {
    id,
    kind: 'character',
    bounds,
    palette,
    pivot,
    animations: {
      idle: { frames: ['idle_0', 'idle_1'], ticksPerFrame: null, loop: 'loop' },
      attack: { frames: ['attack_0'], ticksPerFrame: null, loop: 'once_hold' },
    },
    frames: { idle_0: idle, idle_1: idle, attack_0: attack, default: idle },
  };
}

// Spud Bug — little round critter
export const enemySpud = makeEnemy(
  'enemy_spud',
  ['#9ac24a', '#5e7a2a', '#222222', '#ffffff'],
  [16, 14, 16],
  [
    ...blob(5, 5, 0, 1),
    [4, 6, 7, 2], [11, 6, 7, 2], // eyes
    [4, 6, 8, 3], [11, 6, 8, 3],
    ...box(3, 0, 6, 4, 1, 9, 1), ...box(11, 0, 6, 12, 1, 9, 1), // feet
  ].map(([x, y, z, c]) => [x + 3, y, z + 3, c] as VoxelEntry),
  [
    ...blob(5, 4, 0, 1),
    [4, 5, 9, 2], [11, 5, 9, 2],
  ].map(([x, y, z, c]) => [x + 3, y, z + 3, c] as VoxelEntry),
  [8, 0, 8],
);

// Sky Pecker — bird
export const enemyCrow = makeEnemy(
  'enemy_crow',
  ['#3a3a48', '#1c1c26', '#e8a83a', '#d83a3a'],
  [20, 18, 14],
  [
    ...box(6, 4, 5, 13, 11, 9, 1), // body
    ...box(7, 12, 5, 12, 15, 9, 0), // head
    [13, 13, 6, 2], [13, 13, 8, 2], // beak
    [8, 14, 5, 3], [11, 14, 5, 3], // eyes
    ...box(2, 7, 6, 5, 9, 8, 0), ...box(14, 7, 6, 17, 9, 8, 0), // wings folded
    ...box(8, 0, 6, 8, 3, 7, 2), ...box(11, 0, 6, 11, 3, 7, 2), // legs
  ],
  [
    ...box(6, 5, 5, 13, 12, 9, 1),
    ...box(7, 13, 5, 12, 16, 9, 0),
    [13, 14, 6, 2], [13, 14, 8, 2],
    ...box(0, 11, 6, 5, 13, 8, 0), ...box(14, 11, 6, 19, 13, 8, 0), // wings up
  ],
  [10, 0, 7],
);

// Mush Thug — mushroom bruiser
function mushCap(baseY: number): VoxelEntry[] {
  const cap: VoxelEntry[] = [];
  for (let y = baseY; y <= baseY + 7; y++) {
    const r = 9 - (y - baseY);
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.abs(x) + Math.abs(z) > r + 1) continue;
        cap.push([11 + x, y, 8 + z, 1]);
      }
  }
  cap.push([7, baseY + 4, 8, 2], [15, baseY + 4, 8, 2], [11, baseY + 6, 5, 2], [11, baseY + 6, 11, 2]);
  return cap;
}

export const enemyMush = makeEnemy(
  'enemy_mush',
  ['#e8e0d0', '#c0392b', '#f0f0f0', '#2a2a2a'],
  [22, 22, 18],
  [
    ...box(7, 0, 6, 14, 10, 11, 0), // stalk
    [8, 11, 7, 3], [13, 11, 7, 3], // eyes
    ...mushCap(11),
  ],
  [
    ...box(6, 0, 6, 15, 9, 11, 0),
    ...box(2, 6, 7, 6, 8, 10, 0), ...box(15, 6, 7, 19, 8, 10, 0), // arms out
    ...mushCap(10),
  ],
  [11, 0, 8],
);

// Meadow Brute — boss
export const enemyBrute = makeEnemy(
  'enemy_brute',
  ['#6a8f4a', '#3f5a2a', '#d8c84a', '#2a2a2a', '#b03a3a'],
  [34, 36, 26],
  (() => {
    const v: VoxelEntry[] = [];
    v.push(...box(6, 0, 6, 27, 22, 20, 0)); // body
    v.push(...box(2, 10, 8, 6, 14, 16, 0), ...box(27, 10, 8, 31, 14, 16, 0)); // arms
    v.push(...box(8, 0, 7, 13, 3, 13, 1), ...box(20, 0, 7, 25, 3, 13, 1)); // legs
    v.push(...box(10, 22, 8, 23, 30, 18, 0)); // head
    v.push([12, 26, 7, 2], [21, 26, 7, 2]); // eyes
    v.push([9, 31, 10, 4], [9, 33, 10, 4], [24, 31, 10, 4], [24, 33, 10, 4]); // horns
    v.push(...box(13, 18, 6, 20, 21, 6, 4)); // chest mark
    return v;
  })(),
  (() => {
    const v: VoxelEntry[] = [];
    v.push(...box(6, 0, 8, 27, 22, 22, 0));
    v.push(...box(0, 16, 10, 6, 20, 18, 0), ...box(27, 16, 10, 33, 20, 18, 0)); // arms raised
    v.push(...box(10, 22, 10, 23, 30, 20, 0));
    v.push([12, 25, 9, 2], [21, 25, 9, 2]);
    v.push([9, 31, 12, 4], [24, 31, 12, 4]);
    return v;
  })(),
  [16, 0, 13],
);

export const enemyModels: VoxelModel[] = [enemySpud, enemyCrow, enemyMush, enemyBrute];

export const villagerArchetype: Archetype = {
  id: 'villager',
  kind: 'living',
  defaultState: 'idle',
  npcBrain: 'wander',
  states: {
    idle: { clip: 'idle' },
    idle_random: { clip: 'idle', pool: [{ clip: 'idle', weight: 1 }] },
    walk: { clip: 'walk' },
    talk: { clip: 'talk' },
    interact: { clip: 'talk' },
  },
};

export const townspersonArchetype: Archetype = {
  ...villagerArchetype,
  id: 'townsperson',
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const allModels: VoxelModel[] = [
  heroModel,
  ...villagerModels,
  groundTileModel,
  grassTileModel,
  ...treeModels,
  ...pineModels,
  ...houseModels,
  ...enemyModels,
  fountainModel,
  burningEffigyModel,
  ...flowerModels,
  bushModel,
  rockModel,
  fenceModel,
  signModel,
  lampModel,
  crateModel,
  barrelModel,
  trashcanModel,
  dumpsterModel,
];

export const allArchetypes: Archetype[] = [villagerArchetype, townspersonArchetype];
