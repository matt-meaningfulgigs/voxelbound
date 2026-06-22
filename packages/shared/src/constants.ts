export const VOXEL_UNIT = 1;
export const DEFAULT_VIEW_HEIGHT_VOXELS = 144;
export const DEFAULT_PALETTE_SIZE = 32;
export const TILE_FOOTPRINT = 16;

export const DEFAULT_TIMING = {
  worldTickRate: 60,
  animStepRate: 3,
} as const;

export const DEFAULT_WORLD_SETTINGS = {
  timing: DEFAULT_TIMING,
  camera: {
    projection: 'orthographic' as const,
    pitchDeg: 35,
    yawDeg: 45,
    viewHeightVoxels: DEFAULT_VIEW_HEIGHT_VOXELS,
    fovDeg: 50,
    followDeadzone: 8,
    followSmoothing: 0.12,
    zoom: 1,
  },
  render: {
    scaling: 'fractional' as const,
    ambientIntensity: 0.55,
    dirLight: { intensity: 0.85, azimuthDeg: 220, elevationDeg: 45 },
    shadows: false,
    voxelBevel: 0.05,
    outline: false,
    occlusionFade: true,
    fog: { enabled: false, color: '#87ceeb', near: 80, far: 200 },
    postFx: { battleSwirl: false, bloom: false },
    antialias: 'off' as const,
  },
};
