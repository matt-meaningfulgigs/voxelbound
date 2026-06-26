import { create } from 'zustand';
import type { VoxelModel, AnimationClip, VoxelEntry } from '@voxelbound/shared';

export type VoxelKind = VoxelModel['kind'];
export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

/** Internal editor representation: each frame is a Map keyed "x,y,z" -> palette index. */
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
  '#2d1b0e', '#e8453c', '#f0a020', '#f5e642', '#5ad05a', '#2a9d8f',
  '#3a7ce0', '#7048e8', '#e060c0', '#ffffff', '#c0c0c0', '#707070',
  '#202028', '#8a5a2a', '#d8b070', '#a0e0ff',
];

export const PRESETS: Record<string, [number, number, number]> = {
  Character: [16, 24, 12],
  Item: [8, 8, 8],
  Prop: [16, 16, 16],
  Tile: [16, 8, 16],
  Boss: [32, 32, 24],
};

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

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
    for (const [x, y, z, ci] of entries) map.set(key(x, y, z), ci);
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

interface EditorState {
  doc: EditorDoc;
  activeClip: string;
  activeFrame: number; // index into clip.frames
  activeColor: number; // palette index
  tool: Tool;
  depth: number; // current Z slice
  mirrorX: boolean;
  onion: boolean;
  bump: number; // increment to force re-render after Map mutations

  undoStack: Array<{ frameId: string; data: Array<[string, number]> }>;
  redoStack: Array<{ frameId: string; data: Array<[string, number]> }>;

  load: (doc: EditorDoc) => void;
  frameId: () => string;
  currentFrame: () => Map<string, number>;
  setVoxel: (x: number, y: number, z: number, ci: number | null) => void;
  beginStroke: () => void;
  fill: (x: number, y: number, z: number, ci: number | null) => void;
  clearFrame: () => void;
  undo: () => void;
  redo: () => void;

  setActiveClip: (clip: string) => void;
  setActiveFrame: (i: number) => void;
  setActiveColor: (i: number) => void;
  setTool: (t: Tool) => void;
  setDepth: (d: number) => void;
  toggleMirror: () => void;
  toggleOnion: () => void;

  setId: (id: string) => void;
  setKind: (k: VoxelKind) => void;
  setBounds: (b: [number, number, number]) => void;
  setPivot: (p: [number, number, number]) => void;
  setPaletteColor: (i: number, hex: string) => void;
  addPaletteColor: () => void;

  addClip: (name: string) => void;
  deleteClip: (name: string) => void;
  setClipLoop: (loop: AnimationClip['loop']) => void;
  setClipTicks: (t: number | null) => void;
  addFrame: (copyCurrent: boolean) => void;
  deleteFrame: () => void;
}

function snapshot(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()];
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: emptyDoc(),
  activeClip: 'idle',
  activeFrame: 0,
  activeColor: 1,
  tool: 'pencil',
  depth: 6,
  mirrorX: false,
  onion: true,
  bump: 0,
  undoStack: [],
  redoStack: [],

  load: (doc) => {
    const firstClip = Object.keys(doc.animations)[0] ?? 'idle';
    set({
      doc,
      activeClip: firstClip,
      activeFrame: 0,
      depth: Math.floor(doc.bounds[2] / 2),
      undoStack: [],
      redoStack: [],
      bump: get().bump + 1,
    });
  },

  frameId: () => {
    const { doc, activeClip, activeFrame } = get();
    const clip = doc.animations[activeClip];
    return clip?.frames[activeFrame] ?? clip?.frames[0] ?? 'idle_0';
  },

  currentFrame: () => {
    const fid = get().frameId();
    const f = get().doc.frames[fid];
    if (f) return f;
    const map = new Map<string, number>();
    get().doc.frames[fid] = map;
    return map;
  },

  beginStroke: () => {
    const fid = get().frameId();
    const map = get().currentFrame();
    set((s) => ({
      undoStack: [...s.undoStack.slice(-49), { frameId: fid, data: snapshot(map) }],
      redoStack: [],
    }));
  },

  setVoxel: (x, y, z, ci) => {
    const { doc, mirrorX } = get();
    const map = get().currentFrame();
    const apply = (xx: number) => {
      if (xx < 0 || xx >= doc.bounds[0] || y < 0 || y >= doc.bounds[1] || z < 0 || z >= doc.bounds[2]) return;
      if (ci === null) map.delete(key(xx, y, z));
      else map.set(key(xx, y, z), ci);
    };
    apply(x);
    if (mirrorX) apply(doc.bounds[0] - 1 - x);
    set((s) => ({ bump: s.bump + 1 }));
  },

  fill: (x, y, z, ci) => {
    const { doc } = get();
    const map = get().currentFrame();
    const target = map.get(key(x, y, z));
    const replacement = ci;
    if (target === replacement) return;
    get().beginStroke();
    // flood fill within the current Z slice (2D), matching the clicked color
    const stack = [[x, y]];
    const seen = new Set<string>();
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cx >= doc.bounds[0] || cy < 0 || cy >= doc.bounds[1]) continue;
      const k2 = `${cx},${cy}`;
      if (seen.has(k2)) continue;
      seen.add(k2);
      const cur = map.get(key(cx, cy, z));
      if (cur !== target) continue;
      if (replacement === null) map.delete(key(cx, cy, z));
      else map.set(key(cx, cy, z), replacement);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    set((s) => ({ bump: s.bump + 1 }));
  },

  clearFrame: () => {
    get().beginStroke();
    get().currentFrame().clear();
    set((s) => ({ bump: s.bump + 1 }));
  },

  undo: () => {
    const { undoStack, doc } = get();
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    const cur = doc.frames[last.frameId] ?? new Map();
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, { frameId: last.frameId, data: snapshot(cur) }],
    }));
    doc.frames[last.frameId] = new Map(last.data);
    set((s) => ({ bump: s.bump + 1 }));
  },

  redo: () => {
    const { redoStack, doc } = get();
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    const cur = doc.frames[last.frameId] ?? new Map();
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, { frameId: last.frameId, data: snapshot(cur) }],
    }));
    doc.frames[last.frameId] = new Map(last.data);
    set((s) => ({ bump: s.bump + 1 }));
  },

  setActiveClip: (clip) => set({ activeClip: clip, activeFrame: 0 }),
  setActiveFrame: (i) => set({ activeFrame: i }),
  setActiveColor: (i) => set({ activeColor: i }),
  setTool: (t) => set({ tool: t }),
  setDepth: (d) => set({ depth: d }),
  toggleMirror: () => set((s) => ({ mirrorX: !s.mirrorX })),
  toggleOnion: () => set((s) => ({ onion: !s.onion })),

  setId: (id) => set((s) => ({ doc: { ...s.doc, id } })),
  setKind: (k) => set((s) => ({ doc: { ...s.doc, kind: k } })),
  setBounds: (b) =>
    set((s) => ({ doc: { ...s.doc, bounds: b }, depth: Math.min(s.depth, b[2] - 1), bump: s.bump + 1 })),
  setPivot: (p) => set((s) => ({ doc: { ...s.doc, pivot: p } })),
  setPaletteColor: (i, hex) =>
    set((s) => {
      const palette = [...s.doc.palette];
      palette[i] = hex;
      return { doc: { ...s.doc, palette }, bump: s.bump + 1 };
    }),
  addPaletteColor: () =>
    set((s) => ({ doc: { ...s.doc, palette: [...s.doc.palette, '#ffffff'] } })),

  addClip: (name) =>
    set((s) => {
      if (s.doc.animations[name]) return s;
      const fid = `${name}_0`;
      return {
        doc: {
          ...s.doc,
          animations: { ...s.doc.animations, [name]: { frames: [fid], ticksPerFrame: null, loop: 'loop' } },
          frames: { ...s.doc.frames, [fid]: new Map() },
        },
        activeClip: name,
        activeFrame: 0,
      };
    }),

  deleteClip: (name) =>
    set((s) => {
      if (Object.keys(s.doc.animations).length <= 1) return s;
      const animations = { ...s.doc.animations };
      delete animations[name];
      const first = Object.keys(animations)[0]!;
      return { doc: { ...s.doc, animations }, activeClip: first, activeFrame: 0 };
    }),

  setClipLoop: (loop) =>
    set((s) => ({
      doc: { ...s.doc, animations: { ...s.doc.animations, [s.activeClip]: { ...s.doc.animations[s.activeClip]!, loop } } },
    })),

  setClipTicks: (t) =>
    set((s) => ({
      doc: { ...s.doc, animations: { ...s.doc.animations, [s.activeClip]: { ...s.doc.animations[s.activeClip]!, ticksPerFrame: t } } },
    })),

  addFrame: (copyCurrent) =>
    set((s) => {
      const clip = s.doc.animations[s.activeClip]!;
      let n = clip.frames.length;
      let fid = `${s.activeClip}_${n}`;
      while (s.doc.frames[fid]) fid = `${s.activeClip}_${++n}`;
      const curFid = clip.frames[s.activeFrame] ?? clip.frames[0]!;
      const src = s.doc.frames[curFid];
      const newMap = copyCurrent && src ? new Map(src) : new Map<string, number>();
      const frames = [...clip.frames, fid];
      return {
        doc: {
          ...s.doc,
          animations: { ...s.doc.animations, [s.activeClip]: { ...clip, frames } },
          frames: { ...s.doc.frames, [fid]: newMap },
        },
        activeFrame: frames.length - 1,
      };
    }),

  deleteFrame: () =>
    set((s) => {
      const clip = s.doc.animations[s.activeClip]!;
      if (clip.frames.length <= 1) return s;
      const frames = clip.frames.filter((_, i) => i !== s.activeFrame);
      return {
        doc: { ...s.doc, animations: { ...s.doc.animations, [s.activeClip]: { ...clip, frames } } },
        activeFrame: Math.max(0, s.activeFrame - 1),
      };
    }),
}));

// ---- library (localStorage) ----------------------------------------------

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
