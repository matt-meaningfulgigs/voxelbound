import type { GameStateData } from '../state/GameState';
import { SAVE_SCHEMA_VERSION, randomWorldSeed } from '../state/GameState';

const SLOT_KEY = (slot: number) => `voxelbound.save.${slot}`;
export const SAVE_SLOTS = 3;

export interface SaveMeta {
  slot: number;
  mapName: string;
  leaderName: string;
  level: number;
  partySize: number;
  money: number;
  playTimeMs: number;
  savedAt: number;
}

export interface SaveEnvelope {
  version: number;
  meta: Omit<SaveMeta, 'slot'>;
  data: GameStateData;
}

export class SaveSystem {
  static save(slot: number, data: GameStateData, mapName: string): void {
    const leader = data.party[0];
    const envelope: SaveEnvelope = {
      version: SAVE_SCHEMA_VERSION,
      meta: {
        mapName,
        leaderName: leader?.name ?? 'Hero',
        level: leader?.level ?? 1,
        partySize: data.party.length,
        money: data.money,
        playTimeMs: data.playTimeMs,
        savedAt: Date.now(),
      },
      data,
    };
    try {
      localStorage.setItem(SLOT_KEY(slot), JSON.stringify(envelope));
    } catch (e) {
      console.error('Save failed', e);
    }
  }

  static load(slot: number): GameStateData | null {
    try {
      const raw = localStorage.getItem(SLOT_KEY(slot));
      if (!raw) return null;
      const env = JSON.parse(raw) as SaveEnvelope;
      return migrate(env);
    } catch (e) {
      console.error('Load failed', e);
      return null;
    }
  }

  static meta(slot: number): SaveMeta | null {
    try {
      const raw = localStorage.getItem(SLOT_KEY(slot));
      if (!raw) return null;
      const env = JSON.parse(raw) as SaveEnvelope;
      return { slot, ...env.meta };
    } catch {
      return null;
    }
  }

  static allMeta(): Array<SaveMeta | null> {
    return Array.from({ length: SAVE_SLOTS }, (_, i) => SaveSystem.meta(i));
  }

  static hasAnySave(): boolean {
    return SaveSystem.allMeta().some((m) => m !== null);
  }

  static delete(slot: number): void {
    localStorage.removeItem(SLOT_KEY(slot));
  }
}

/** Run ordered migrations so old saves keep working across schema bumps. */
function migrate(env: SaveEnvelope): GameStateData {
  const data = env.data;
  let version = env.version ?? 0;
  while (version < SAVE_SCHEMA_VERSION) {
    if (version === 1) {
      // v1 -> v2: world became procedural; assign a stable seed to old saves.
      if (typeof data.worldSeed !== 'number') data.worldSeed = randomWorldSeed();
    }
    version += 1;
  }
  data.schemaVersion = SAVE_SCHEMA_VERSION;
  return data;
}
