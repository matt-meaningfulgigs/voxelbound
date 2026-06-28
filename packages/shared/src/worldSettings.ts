import { z } from 'zod';

export const TimingConfigSchema = z.object({
  worldTickRate: z.number().min(1).max(480).default(60),
  animStepRate: z.number().min(0.5).max(60).default(3),
});

export type TimingConfig = z.infer<typeof TimingConfigSchema>;

export function ticksPerAnimFrame(cfg: TimingConfig): number {
  return Math.max(1, Math.round(cfg.worldTickRate / cfg.animStepRate));
}

export const CameraConfigSchema = z.object({
  projection: z.enum(['orthographic', 'perspective']).default('orthographic'),
  pitchDeg: z.number().default(35),
  yawDeg: z.number().default(0),
  viewHeightVoxels: z.number().default(150),
  fovDeg: z.number().default(50),
  followDeadzone: z.number().default(8),
  followSmoothing: z.number().default(0.12),
  zoom: z.number().default(1),
});

export const RenderConfigSchema = z.object({
  scaling: z.enum(['fractional', 'integerSnap']).default('fractional'),
  ambientIntensity: z.number().default(0.55),
  dirLight: z.object({
    intensity: z.number(),
    azimuthDeg: z.number(),
    elevationDeg: z.number(),
  }),
  shadows: z.boolean().default(false),
  voxelBevel: z.number().default(0.05),
  outline: z.boolean().default(false),
  occlusionFade: z.boolean().default(true),
  fog: z.object({
    enabled: z.boolean(),
    color: z.string(),
    near: z.number(),
    far: z.number(),
  }),
  postFx: z.object({
    battleSwirl: z.boolean(),
    bloom: z.boolean(),
    colorGrade: z.string().optional(),
  }),
  antialias: z.enum(['off', 'fxaa', 'msaa']).default('off'),
});

export const WorldSettingsSchema = z.object({
  timing: TimingConfigSchema,
  camera: CameraConfigSchema,
  render: RenderConfigSchema,
});

export type CameraConfig = z.infer<typeof CameraConfigSchema>;
export type RenderConfig = z.infer<typeof RenderConfigSchema>;
export type WorldSettings = z.infer<typeof WorldSettingsSchema>;
