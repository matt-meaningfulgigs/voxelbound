import { z } from 'zod';

export const VoxelEntrySchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int().min(0),
]);

export type VoxelEntry = z.infer<typeof VoxelEntrySchema>;

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
