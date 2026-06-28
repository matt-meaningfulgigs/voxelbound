import { z } from 'zod';

export const VoxelEntrySchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int().min(0),
]);

export type VoxelEntry = z.infer<typeof VoxelEntrySchema>;

/** Per-palette-slot emission behavior for shader / particle systems. */
export const EmitterKindSchema = z.enum(['solid', 'fire', 'smoke', 'water']);
export type EmitterKind = z.infer<typeof EmitterKindSchema>;

export const AnimationClipSchema = z.object({
  frames: z.array(z.string()).min(1),
  ticksPerFrame: z.number().nullable().default(null),
  loop: z.enum(['loop', 'ping_pong', 'once', 'once_hold']).default('loop'),
});

export const VoxelModelSchema = z.object({
  id: z.string(),
  kind: z.enum(['character', 'item', 'prop', 'tile', 'interactive']),
  bounds: z.tuple([z.number(), z.number(), z.number()]),
  palette: z.array(z.string()),
  pivot: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  animations: z.record(AnimationClipSchema).default({}),
  frames: z.record(z.array(VoxelEntrySchema)),
  /** Parallel to palette — how each slot behaves in the world (default solid). */
  paletteEmitters: z.array(EmitterKindSchema).optional(),
  behavior: z.enum(['displace', 'fluid']).optional(),
});

export type VoxelModel = z.infer<typeof VoxelModelSchema>;
export type AnimationClip = z.infer<typeof AnimationClipSchema>;

export const ArchetypeStateSchema = z.object({
  clip: z.string(),
  pool: z
    .array(z.object({ clip: z.string(), weight: z.number() }))
    .optional(),
});

export const ArchetypeSchema = z.object({
  id: z.string(),
  kind: z.enum(['living', 'item', 'prop', 'tile']),
  states: z.record(ArchetypeStateSchema),
  defaultState: z.string().default('idle'),
  npcBrain: z.enum(['fixed', 'wander', 'path', 'schedule']).optional(),
});

export type Archetype = z.infer<typeof ArchetypeSchema>;

export function parseHexColor(hex: string): number {
  const h = hex.replace('#', '');
  return parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
}

export function voxelsFromFrame(
  model: VoxelModel,
  frameId: string,
): Array<{ x: number; y: number; z: number; color: number }> {
  const entries = model.frames[frameId] ?? [];
  return entries.map(([x, y, z, ci]) => ({
    x,
    y,
    z,
    color: parseHexColor(model.palette[ci] ?? '#ff00ff'),
  }));
}

export function emitterKindFor(model: VoxelModel, paletteIndex: number): EmitterKind {
  return model.paletteEmitters?.[paletteIndex] ?? 'solid';
}

export interface EmitterVoxel {
  x: number;
  y: number;
  z: number;
  kind: Exclude<EmitterKind, 'solid'>;
}

/** Model-space emitter voxels for a frame (skips solid palette slots). */
export function emittersFromFrame(model: VoxelModel, frameId: string): EmitterVoxel[] {
  const out: EmitterVoxel[] = [];
  for (const [x, y, z, ci] of model.frames[frameId] ?? []) {
    const kind = emitterKindFor(model, ci);
    if (kind === 'solid') continue;
    out.push({ x, y, z, kind });
  }
  return out;
}

/** Rotate model-local offset by prop facing (0–3 quarter turns). */
export function rotateFacingOffset(
  lx: number,
  lz: number,
  facing: 0 | 1 | 2 | 3,
): { x: number; z: number } {
  switch (facing & 3) {
    case 1:
      return { x: -lz, z: lx };
    case 2:
      return { x: -lx, z: -lz };
    case 3:
      return { x: lz, z: -lx };
    default:
      return { x: lx, z: lz };
  }
}

/** World-space emitters for a placed prop (matches {@link placeProp} pivot + facing). */
export function worldEmittersFromPlacement(
  model: VoxelModel,
  frameId: string,
  worldX: number,
  worldY: number,
  worldZ: number,
  facing: 0 | 1 | 2 | 3 = 0,
): EmitterVoxel[] {
  const [pvx, , pvz] = model.pivot;
  return emittersFromFrame(model, frameId).map(({ x, y, z, kind }) => {
    const lx = x - pvx;
    const lz = z - pvz;
    const r = rotateFacingOffset(lx, lz, facing);
    return { x: worldX + r.x, y: worldY + y, z: worldZ + r.z, kind };
  });
}
