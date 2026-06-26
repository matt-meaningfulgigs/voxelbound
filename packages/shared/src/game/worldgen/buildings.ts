// ---------------------------------------------------------------------------
// Town building system. A deterministic town layout (stable per worldSeed), a
// parametric voxel building generator (cottages, houses, manors, shops, a town
// hall and a church), and a procedural interior generator so EVERY building is
// enterable. Landmark buildings (store/inn/home) keep their hand-authored
// interiors; the rest get generated ones.
// ---------------------------------------------------------------------------

import type { VoxelEntry, VoxelModel } from '../../voxelModel';
import type { InteriorMap, MapProp } from '../types';
import { Rng, hashSeed } from './noise';

export type BuildingKind = 'cottage' | 'house' | 'manor' | 'shop' | 'inn' | 'hall' | 'church';

export interface BuildingSpec {
  /** Overworld marker id (and procedural interior id base). */
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  facing: 0 | 2; // door faces +z (0) or -z (2)
  w: number;
  d: number;
  wallH: number;
  roofH: number;
  stories: number;
  palette: string[];
  /** Map entered through the door (existing landmark id, or `${id}_interior`). */
  interiorMap: string;
  /** World position of the door trigger / outside spawn. */
  doorX: number;
  doorZ: number;
  enterFacing: 0 | 2;
}

const WALL_PALETTES: string[][] = [
  ['#e8d8b8', '#c0392b', '#5a3a1a', '#bfe8f0', '#a89878', '#8a8076', '#9c2b20', '#d8c068'],
  ['#e6ead0', '#3a5aa8', '#5a3a1a', '#cdeede', '#b0b49a', '#86827a', '#2e4a90', '#c8d0a0'],
  ['#f0e6c8', '#3a8c4a', '#5a3a1a', '#bfe6f0', '#cabf98', '#8a8076', '#2e7038', '#d8c878'],
  ['#ece0d8', '#7a4ab0', '#4a2a1a', '#e0d2f0', '#bbab9e', '#86827a', '#643a96', '#c8a8e0'],
  ['#e0d2c0', '#b06a30', '#4a2a1a', '#d8e6f0', '#b8a890', '#86827a', '#8a5020', '#e0b070'],
];

/** Deterministic town building layout. Stable for a given world seed. */
export function townBuildings(seed: number): BuildingSpec[] {
  const rng = new Rng(hashSeed(seed, 0xb1d9));
  const specs: BuildingSpec[] = [];

  const pick = (i: number): string[] => WALL_PALETTES[i % WALL_PALETTES.length]!;

  // --- north row (doors face +z toward the z=200 avenue) ---
  // Landmarks keep their authored interiors.
  const northRow: Array<{ x: number; kind: BuildingKind; interior?: string }> = [
    { x: 130, kind: 'shop', interior: 'store_interior' },
    { x: 210, kind: 'inn', interior: 'inn_interior' },
    { x: 300, kind: 'house', interior: 'home_interior' },
    { x: 392, kind: 'hall' },
  ];
  northRow.forEach((b, i) => {
    const big = b.kind === 'hall';
    const stories = big ? 2 : 1;
    const w = big ? 52 : 36 + rng.int(0, 6);
    const d = big ? 40 : 32 + rng.int(0, 4);
    const wallH = stories === 2 ? 40 : 24 + rng.int(0, 4);
    const z = big ? 158 : 165;
    const doorZ = z + d / 2 + 4;
    specs.push({
      id: `bld_n${i}`,
      kind: b.kind,
      x: b.x,
      z,
      facing: 0,
      w,
      d,
      wallH,
      roofH: big ? 10 : 14,
      stories,
      palette: pick(i),
      interiorMap: b.interior ?? `bld_n${i}_interior`,
      doorX: b.x,
      doorZ,
      enterFacing: 0,
    });
  });

  // --- south row (doors face -z toward the z=332 avenue) ---
  const southKinds: BuildingKind[] = ['cottage', 'house', 'manor', 'church'];
  const southX = [130, 212, 294, 372];
  southKinds.forEach((kind, i) => {
    const tall = kind === 'manor';
    const church = kind === 'church';
    const stories = tall ? 2 : 1;
    const w = church ? 30 : tall ? 44 : 34 + rng.int(0, 6);
    const d = church ? 42 : tall ? 40 : 30 + rng.int(0, 4);
    const wallH = stories === 2 ? 42 : 24 + rng.int(0, 4);
    const z = 352;
    const doorZ = z - d / 2 - 4;
    specs.push({
      id: `bld_s${i}`,
      kind,
      x: southX[i]!,
      z,
      facing: 2,
      w,
      d,
      wallH,
      roofH: church ? 12 : 14,
      stories,
      palette: pick(i + 2),
      interiorMap: `bld_s${i}_interior`,
      doorX: southX[i]!,
      doorZ,
      enterFacing: 2,
    });
  });

  return specs;
}

// ---------------------------------------------------------------------------
// Voxel building generator
// Palette: 0 wall · 1 roof · 2 door · 3 window · 4 trim · 5 stone · 6 roofDark · 7 accent
// ---------------------------------------------------------------------------

function buildingFrame(spec: BuildingSpec): VoxelEntry[] {
  const { w: W, d: D, wallH, roofH, stories, kind } = spec;
  const v: VoxelEntry[] = [];
  const cx = Math.floor(W / 2);
  const doorX0 = cx - 4;
  const doorX1 = cx + 3;
  const doorY1 = 15;
  const flatRoof = kind === 'hall' || kind === 'shop';
  const storyH = Math.floor((wallH - 2) / stories);

  const isDoor = (x: number, y: number, z: number): boolean =>
    z === D - 1 && x >= doorX0 && x <= doorX1 && y >= 2 && y <= doorY1;

  const isWin = (x: number, y: number, z: number): boolean => {
    for (let s = 0; s < stories; s++) {
      const wy0 = 4 + s * storyH + 3;
      const wy1 = wy0 + 4;
      if (y < wy0 || y > wy1) continue;
      const sideX = (x >= 4 && x <= 8) || (x >= W - 9 && x <= W - 5) || (Math.abs(x - cx) <= 2 && s > 0);
      const sideZ = (z >= 6 && z <= 10) || (z >= D - 11 && z <= D - 7);
      if ((z === 0 || z === D - 1) && sideX) return true;
      if ((x === 0 || x === W - 1) && sideZ) return true;
    }
    return false;
  };

  // stone foundation
  v.push(...box(0, 0, 0, W - 1, 1, D - 1, 5));

  // wall shell with carved openings
  for (let y = 2; y <= wallH; y++)
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++) {
        if (!(x === 0 || x === W - 1 || z === 0 || z === D - 1)) continue;
        if (isDoor(x, y, z)) continue; // carved open doorway
        if (isWin(x, y, z)) v.push([x, y, z, 3]);
        else v.push([x, y, z, 0]);
      }

  // floor band between stories
  if (stories > 1) {
    const fy = 2 + storyH;
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++)
        if (x === 0 || x === W - 1 || z === 0 || z === D - 1) v.push([x, fy, z, 4]);
  }

  // corner posts
  for (let y = 2; y <= wallH; y++) {
    v.push([0, y, 0, 4], [W - 1, y, 0, 4], [0, y, D - 1, 4], [W - 1, y, D - 1, 4]);
  }
  // door frame + lintel
  for (let y = 2; y <= doorY1 + 1; y++) {
    v.push([doorX0 - 1, y, D - 1, 4], [doorX1 + 1, y, D - 1, 4]);
  }
  for (let x = doorX0 - 1; x <= doorX1 + 1; x++) v.push([x, doorY1 + 1, D - 1, 4]);

  if (flatRoof) {
    // flat roof + parapet
    for (let x = -1; x <= W; x++)
      for (let z = -1; z <= D; z++) v.push([x, wallH + 1, z, 6]);
    for (let x = -1; x <= W; x++) {
      v.push([x, wallH + 2, -1, 4], [x, wallH + 2, D, 4]);
    }
    for (let z = -1; z <= D; z++) {
      v.push([-1, wallH + 2, z, 4], [W, wallH + 2, z, 4]);
    }
    // hall portico columns at the door
    if (kind === 'hall') {
      for (const px of [doorX0 - 3, doorX1 + 3]) {
        for (let y = 2; y <= wallH; y++) v.push([px, y, D, 5]);
      }
    }
  } else {
    // eave + gable roof (ridge along X)
    v.push(...box(-1, wallH + 1, -1, W, wallH + 1, D, 4));
    const czf = (D - 1) / 2;
    const topAt = (z: number): number => Math.round(wallH + roofH * (1 - Math.abs(z - czf) / czf));
    for (let z = 0; z < D; z++) {
      const top = topAt(z);
      for (let y = wallH + 1; y < top; y++) v.push([0, y, z, 0], [W - 1, y, z, 0]);
      for (let x = -1; x <= W; x++) v.push([x, top, z, 1], [x, top - 1, z, 6]);
    }
    // chimney
    const chX = W - 9;
    for (let y = wallH; y <= wallH + roofH + 3; y++) v.push(...box(chX, y, 5, chX + 2, y, 7, 5));
  }

  // church steeple over the door side
  if (kind === 'church') {
    const sx = cx;
    const top = wallH + roofH + 14;
    for (let y = wallH; y <= top; y++) v.push(...box(sx - 2, y, D - 4, sx + 2, y, D, 0));
    for (let y = top + 1; y <= top + 5; y++) {
      const r = top + 5 - y;
      v.push(...box(sx - r, y, D - 3 - r, sx + r, y, D - 3 + r, 1));
    }
    // cross
    v.push([sx, top + 8, D - 3, 7], [sx, top + 9, D - 3, 7], [sx, top + 10, D - 3, 7]);
    v.push([sx - 1, top + 9, D - 3, 7], [sx + 1, top + 9, D - 3, 7]);
  }

  return v;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ci: number): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) v.push([x, y, z, ci]);
  return v;
}

/** Build the VoxelModel for a building spec. */
export function generateBuildingModel(spec: BuildingSpec): VoxelModel {
  const extra = spec.kind === 'church' ? spec.roofH + 30 : spec.roofH + 8;
  return {
    id: spec.id,
    kind: 'prop',
    bounds: [spec.w + 2, spec.wallH + extra, spec.d + 2],
    palette: spec.palette,
    pivot: [spec.w / 2, 0, spec.d / 2],
    animations: {},
    frames: { default: buildingFrame(spec) },
  };
}

// ---------------------------------------------------------------------------
// Procedural interiors
// ---------------------------------------------------------------------------

const INTERIOR_NAMES: Record<BuildingKind, string> = {
  cottage: 'Cottage',
  house: 'Home',
  manor: 'Manor',
  shop: 'Shop',
  inn: 'Inn',
  hall: 'Town Hall',
  church: 'Chapel',
};

const FLOOR_COLORS = [0xa88c5a, 0x9a7a8a, 0xb8966a, 0x8a7048, 0xa07c6a];
const WALL_COLORS = [0xd8c49c, 0xc9b0c0, 0xd9c4a0, 0xc4b48c, 0xceb6a8];
const RESIDENT_MODELS = ['villager_green', 'villager_purple', 'villager_teal', 'villager_orange', 'villager_pink', 'villager_gray'];
const TOWNSFOLK_DIALOGUES = ['townsfolk_1', 'townsfolk_2', 'townsfolk_3', 'townsfolk_4', 'townsfolk_5'];

/** Interior floor dimensions for a building (shared by gen + spawn). */
export function interiorDims(spec: BuildingSpec): { w: number; d: number } {
  const big = spec.stories > 1 || spec.kind === 'hall' || spec.kind === 'church';
  return {
    w: Math.round(80 + spec.w * (big ? 1.6 : 1.1)),
    d: Math.round(70 + spec.d * (big ? 1.6 : 1.1)),
  };
}

/** Where the player appears when entering this building (just inside the door). */
export function interiorSpawn(spec: BuildingSpec): { x: number; z: number } {
  const { w, d } = interiorDims(spec);
  return { x: Math.round(w / 2), z: d - 20 };
}

/** Generate an interior map for a building (used for non-landmark buildings). */
export function generateInterior(seed: number, spec: BuildingSpec): InteriorMap {
  const rng = new Rng(hashSeed(seed, hashSeed(spec.x | 0, spec.z | 0)));
  const { w, d } = interiorDims(spec);
  const cx = Math.round(w / 2);

  // exit door is at the south wall, returning just outside the building's door
  const doors = [
    {
      x: cx,
      z: d - 10,
      toMap: 'overworld',
      toX: spec.doorX,
      toZ: spec.facing === 0 ? spec.doorZ + 16 : spec.doorZ - 16,
      enterFacing: 2 as const,
    },
  ];

  // a resident who wanders and chats
  const npcs = [
    {
      id: `${spec.id}_resident`,
      modelId: rng.pick(RESIDENT_MODELS),
      x: rng.int(24, w - 24),
      z: rng.int(20, d - 30),
      facing: 2 as const,
      dialogue: rng.pick(TOWNSFOLK_DIALOGUES),
      wander: true,
    },
  ];

  // furniture scattered along the walls
  const props: MapProp[] = [];
  const furniture = ['crate', 'barrel', 'trashcan', 'lamp'];
  const n = 3 + rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const onSide = rng.chance(0.5);
    const x = onSide ? (rng.chance(0.5) ? 18 : w - 18) : rng.int(20, w - 20);
    const z = onSide ? rng.int(20, d - 24) : 20;
    props.push({ modelId: rng.pick(furniture), x, z });
  }

  return {
    id: spec.interiorMap,
    name: INTERIOR_NAMES[spec.kind],
    w,
    d,
    floorColor: FLOOR_COLORS[rng.int(0, FLOOR_COLORS.length - 1)]!,
    wallColor: WALL_COLORS[rng.int(0, WALL_COLORS.length - 1)]!,
    bgColor: 0x231f1a,
    npcs,
    doors,
    props,
  };
}
