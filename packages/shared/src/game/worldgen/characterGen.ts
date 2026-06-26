// ---------------------------------------------------------------------------
// Parametric voxel character generator. Produces chunky, EarthBound-flavored
// townsfolk: a humanoid rig (oversized head, stubby limbs) composed from parts
// with seeded palettes (skin / hair / shirt / pants / shoe / accent) and size
// classes (child / adult / tall / large / huge). Frames cover idle / walk /
// talk; 4-direction facing is handled by the scene rotating the container.
//
// Palette index map: 0 skin · 1 hair · 2 shirt · 3 pants · 4 shoe · 5 accent
// ---------------------------------------------------------------------------

import type { VoxelEntry, VoxelModel } from '../../voxelModel';
import { Rng, hashSeed } from './noise';

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ci: number): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) v.push([x, y, z, ci]);
  return v;
}

export type SizeClass = 'child' | 'adult' | 'tall' | 'large' | 'huge';

interface Proportions {
  legH: number;
  torsoH: number;
  torsoHW: number; // torso half-width
  headH: number;
  headHW: number; // head half-width
  armLen: number;
  scale: number;
}

const SIZE_PROPS: Record<SizeClass, Proportions> = {
  child: { legH: 3, torsoH: 4, torsoHW: 2, headH: 4, headHW: 3, armLen: 3, scale: 0.74 },
  adult: { legH: 5, torsoH: 6, torsoHW: 2, headH: 4, headHW: 2, armLen: 4, scale: 1.0 },
  tall: { legH: 7, torsoH: 7, torsoHW: 2, headH: 4, headHW: 2, armLen: 5, scale: 1.06 },
  large: { legH: 4, torsoH: 7, torsoHW: 3, headH: 4, headHW: 3, armLen: 4, scale: 1.14 },
  huge: { legH: 6, torsoH: 9, torsoHW: 4, headH: 5, headHW: 4, armLen: 6, scale: 1.5 },
};

const SKIN = ['#f4c99a', '#e8b890', '#d9a878', '#c68a5a', '#a9784e', '#8a5a36', '#f6d0b0', '#e0a070'];
const HAIR = ['#2a1a0a', '#5a3a1a', '#1a1a2a', '#6a3a1a', '#888888', '#3a2a1a', '#c0a050', '#7a4a2a', '#a83a2a', '#dadada'];
const SHIRT = ['#3a8c4a', '#7a4ab0', '#2a9c9c', '#e88a2a', '#e87aa8', '#6a6a72', '#e8453c', '#3a5aa8', '#d8c050', '#4aa0d8'];
const PANTS = ['#6b4a2a', '#3a3a4a', '#404048', '#5a4a3a', '#2d4a8a', '#3a3a40', '#503a2a', '#444'];
const SHOE = ['#222', '#111', '#1a1a1a', '#3a2a1a'];
const ACCENT = ['#d83a3a', '#3a6ad8', '#e8c030', '#37915a', '#9a4ac0', '#e07020'];

type Hat = 'none' | 'cap' | 'brim' | 'tall';

interface CharSpec {
  p: Proportions;
  skin: number; // hex
  hair: number;
  shirt: number;
  pants: number;
  shoe: number;
  accent: number;
  hat: Hat;
  hairTuft: boolean;
}

const SIZE_BY_WEIGHT: SizeClass[] = ['adult', 'adult', 'adult', 'tall', 'large', 'child', 'child', 'huge'];

function rollSpec(rng: Rng, forced?: SizeClass): CharSpec {
  const sizeClass = forced ?? rng.pick(SIZE_BY_WEIGHT);
  const hat: Hat = rng.chance(0.35) ? rng.pick(['cap', 'brim', 'tall'] as Hat[]) : 'none';
  return {
    p: SIZE_PROPS[sizeClass],
    skin: parseInt(rng.pick(SKIN).slice(1), 16),
    hair: parseInt(rng.pick(HAIR).slice(1), 16),
    shirt: parseInt(rng.pick(SHIRT).slice(1), 16),
    pants: parseInt(rng.pick(PANTS).slice(1), 16),
    shoe: parseInt(rng.pick(SHOE).slice(1), 16),
    accent: parseInt(rng.pick(ACCENT).slice(1), 16),
    hat,
    hairTuft: rng.chance(0.4),
  };
}

/** Build one body pose. legShift sways legs, armRaise lifts the left arm, headBob nods. */
function bodyFrame(s: CharSpec, legShift: number, armRaise: number, headBob: number): VoxelEntry[] {
  const p = s.p;
  const cx = 8;
  const z0 = 3;
  const z1 = 6;
  const v: VoxelEntry[] = [];

  // feet
  v.push(...box(cx - p.torsoHW - 1, 0, z0, cx - 1, 1, z1, 4));
  v.push(...box(cx, 0, z0, cx + p.torsoHW + 1, 1, z1, 4));
  // legs (pants)
  const legTop = 1 + p.legH;
  v.push(...box(cx - p.torsoHW - 1 + legShift, 2, z0, cx - 1 + legShift, legTop, z1, 3));
  v.push(...box(cx + 1 - legShift, 2, z0, cx + p.torsoHW + 1 - legShift, legTop, z1, 3));
  // torso (shirt)
  const tY0 = legTop + 1;
  const tY1 = tY0 + p.torsoH;
  v.push(...box(cx - p.torsoHW, tY0, z0 - 1, cx + p.torsoHW, tY1, z1, 2));
  // arms (shirt sleeves + skin hands)
  const aTop = tY1;
  const aBot = aTop - p.armLen;
  v.push(...box(cx - p.torsoHW - 1, aBot + armRaise, z0, cx - p.torsoHW - 1, aTop + armRaise, z1 - 1, 2));
  v.push(...box(cx + p.torsoHW + 1, aBot, z0, cx + p.torsoHW + 1, aTop, z1 - 1, 2));
  v.push([cx - p.torsoHW - 1, aBot + armRaise, z0, 0], [cx + p.torsoHW + 1, aBot, z0, 0]);
  // head (skin)
  const hY0 = tY1 + 1 + headBob;
  const hY1 = hY0 + p.headH;
  v.push(...box(cx - p.headHW, hY0, z0, cx + p.headHW, hY1, z1, 0));
  // eyes
  v.push([cx - p.headHW, hY0 + Math.max(1, p.headH - 2), z0, 1], [cx + p.headHW, hY0 + Math.max(1, p.headH - 2), z0, 1]);
  // hair (cap over the crown + sides)
  v.push(...box(cx - p.headHW, hY1, z0 - 1, cx + p.headHW, hY1 + 1, z1, 1));
  v.push(...box(cx - p.headHW, hY0 + p.headH - 1, z1, cx + p.headHW, hY1, z1, 1)); // back hair
  if (s.hairTuft) v.push([cx, hY1 + 2, z1 - 1, 1], [cx, hY1 + 2, z1, 1]);
  // hat (accent)
  if (s.hat !== 'none') {
    const brimY = hY1 + 1;
    if (s.hat === 'brim') v.push(...box(cx - p.headHW - 1, brimY, z0 - 1, cx + p.headHW + 1, brimY, z1 + 1, 5));
    if (s.hat === 'cap') v.push(...box(cx - p.headHW, brimY, z0 - 2, cx + p.headHW, brimY, z0 - 1, 5));
    const crownH = s.hat === 'tall' ? 4 : 1;
    v.push(...box(cx - p.headHW, brimY + 1, z0, cx + p.headHW, brimY + crownH, z1, 5));
  }
  return v;
}

const CHARACTER_ANIMS = {
  idle: { frames: ['idle_0', 'idle_1'], ticksPerFrame: null, loop: 'loop' as const },
  walk: { frames: ['walk_0', 'walk_1', 'walk_2', 'walk_1'], ticksPerFrame: null, loop: 'loop' as const },
  talk: { frames: ['talk_0', 'talk_1'], ticksPerFrame: null, loop: 'loop' as const },
};

export interface GeneratedCharacter {
  model: VoxelModel;
  scale: number;
  sizeClass: SizeClass;
}

/** Generate a seeded, diverse voxel townsperson model + recommended scale. */
export function generateCharacter(id: string, seed: number, forced?: SizeClass): GeneratedCharacter {
  const rng = new Rng(hashSeed(seed, 0xc4a2));
  const s = rollSpec(rng, forced);
  const palette = [
    `#${s.skin.toString(16).padStart(6, '0')}`,
    `#${s.hair.toString(16).padStart(6, '0')}`,
    `#${s.shirt.toString(16).padStart(6, '0')}`,
    `#${s.pants.toString(16).padStart(6, '0')}`,
    `#${s.shoe.toString(16).padStart(6, '0')}`,
    `#${s.accent.toString(16).padStart(6, '0')}`,
  ];

  const frames: Record<string, VoxelEntry[]> = {
    idle_0: bodyFrame(s, 0, 0, 0),
    idle_1: bodyFrame(s, 0, 0, 1),
    walk_0: bodyFrame(s, 1, 0, 0),
    walk_1: bodyFrame(s, 0, 0, 0),
    walk_2: bodyFrame(s, -1, 0, 0),
    talk_0: bodyFrame(s, 0, 0, 0),
    talk_1: bodyFrame(s, 0, 1, 0),
    default: bodyFrame(s, 0, 0, 0),
  };

  const totalH = 2 + s.p.legH + 1 + s.p.torsoH + 1 + s.p.headH + 6;
  return {
    model: {
      id,
      kind: 'character',
      bounds: [18, totalH, 12],
      palette,
      pivot: [8, 0, 4.5],
      animations: CHARACTER_ANIMS,
      frames,
    },
    scale: s.p.scale,
    sizeClass: forced ?? 'adult',
  };
}

/** Stable size-class selection for a given seed (so callers can vary the crowd). */
export function pickSizeClass(seed: number): SizeClass {
  return new Rng(hashSeed(seed, 0x51ce)).pick(SIZE_BY_WEIGHT);
}
