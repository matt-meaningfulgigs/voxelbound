import { create } from 'zustand';
import type { WorldSettings } from '@voxelbound/shared';
import { DEFAULT_WORLD_SETTINGS } from '@voxelbound/shared';

interface StudioState {
  settings: WorldSettings;
  setSettings: (s: WorldSettings) => void;
  patchSettings: (patch: Partial<WorldSettings['camera']>) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  settings: structuredClone(DEFAULT_WORLD_SETTINGS),
  setSettings: (settings) => set({ settings }),
  patchSettings: (patch) =>
    set((s) => ({
      settings: {
        ...s.settings,
        camera: { ...s.settings.camera, ...patch },
      },
    })),
}));
