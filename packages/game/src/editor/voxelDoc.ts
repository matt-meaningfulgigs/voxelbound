import type { VoxelModel, AnimationClip, VoxelEntry } from '@voxelbound/shared';

export type VoxelKind = VoxelModel['kind'];

/** Editor representation: each frame is a Map keyed "x,y,z" -> palette index. */
export interface EditorDoc {
  id: string;
  kind: VoxelKind;
  bounds: [number, number, number];
  palette: string[];
  pivot: [number, number, number];
  animations: Record<string, AnimationClip>;
  frames: Record<string, Map<string, number>>;
}

export const DEFAULT_PALETTE = [
  '#e8453c', '#f0a020', '#f5e642', '#5ad05a', '#2a9d8f', '#3a7ce0',
  '#7048e8', '#e060c0', '#ffffff', '#c0c0c0', '#707070', '#202028',
  '#8a5a2a', '#d8b070', '#a0e0ff', '#2d1b0e',
];

export const PRESETS: Record<string, { kind: VoxelKind; bounds: [number, number, number] }> = {
  Character: { kind: 'character', bounds: [16, 24, 12] },
  Item: { kind: 'item', bounds: [10, 10, 10] },
  Prop: { kind: 'prop', bounds: [16, 16, 16] },
  Tile: { kind: 'tile', bounds: [16, 8, 16] },
  Boss: { kind: 'character', bounds: [30, 32, 24] },
};

export const vkey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function emptyDoc(kind: VoxelKind = 'character', bounds: [number, number, number] = [16, 24, 12]): EditorDoc {
  return {
    id: 'new_model',
    kind,
    bounds,
    palette: [...DEFAULT_PALETTE],
    pivot: [Math.floor(bounds[0] / 2), 0, Math.floor(bounds[2] / 2)],
    animations: { idle: { frames: ['idle_0'], ticksPerFrame: null, loop: 'loop' } },
    frames: { idle_0: new Map() },
  };
}

export function docFromModel(m: VoxelModel): EditorDoc {
  const frames: Record<string, Map<string, number>> = {};
  for (const [fid, entries] of Object.entries(m.frames)) {
    const map = new Map<string, number>();
    for (const [x, y, z, ci] of entries) map.set(vkey(x, y, z), ci);
    frames[fid] = map;
  }
  return {
    id: m.id,
    kind: m.kind,
    bounds: [...m.bounds] as [number, number, number],
    palette: [...m.palette],
    pivot: [...m.pivot] as [number, number, number],
    animations: structuredClone(m.animations),
    frames,
  };
}

export function modelFromDoc(d: EditorDoc): VoxelModel {
  const frames: Record<string, VoxelEntry[]> = {};
  for (const [fid, map] of Object.entries(d.frames)) {
    const arr: VoxelEntry[] = [];
    for (const [k, ci] of map) {
      const [x, y, z] = k.split(',').map(Number);
      arr.push([x!, y!, z!, ci]);
    }
    frames[fid] = arr;
  }
  return {
    id: d.id,
    kind: d.kind,
    bounds: [...d.bounds] as [number, number, number],
    palette: [...d.palette],
    pivot: [...d.pivot] as [number, number, number],
    animations: structuredClone(d.animations),
    frames,
  };
}

// ---- library (localStorage, shared with the standalone Studio) ------------

const LIB_KEY = 'voxelbound.studio.library';

export function loadLibrary(): VoxelModel[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    return raw ? (JSON.parse(raw) as VoxelModel[]) : [];
  } catch {
    return [];
  }
}

export function saveToLibrary(model: VoxelModel): void {
  const lib = loadLibrary().filter((m) => m.id !== model.id);
  lib.push(model);
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
}

export function deleteFromLibrary(id: string): void {
  const lib = loadLibrary().filter((m) => m.id !== id);
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
}
