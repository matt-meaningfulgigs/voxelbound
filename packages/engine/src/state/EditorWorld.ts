/**
 * Persistent registry of player-placed props per map, used by the in-game
 * World Editor. Stored in localStorage so creations survive reloads and are
 * re-applied whenever a map is (re)built by the OverworldScene.
 */
export interface Placement {
  modelId: string;
  x: number;
  z: number;
  facing: number;
  solid?: boolean;
}

const KEY = 'voxelbound.editor.world';

type WorldMap = Record<string, Placement[]>;

function readAll(): WorldMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WorldMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: WorldMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

export const EditorWorld = {
  get(mapId: string): Placement[] {
    return readAll()[mapId] ?? [];
  },
  add(mapId: string, p: Placement): void {
    const all = readAll();
    (all[mapId] ??= []).push(p);
    writeAll(all);
  },
  removeLast(mapId: string): Placement | null {
    const all = readAll();
    const list = all[mapId];
    if (!list || list.length === 0) return null;
    const removed = list.pop()!;
    writeAll(all);
    return removed;
  },
  clear(mapId: string): void {
    const all = readAll();
    delete all[mapId];
    writeAll(all);
  },
};
