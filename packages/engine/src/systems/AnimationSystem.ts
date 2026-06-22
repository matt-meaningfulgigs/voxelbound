import type { Archetype, VoxelModel } from '@voxelbound/shared';
import type { AnimationState } from '../ecs/World';

export class AnimationSystem {
  private models = new Map<string, VoxelModel>();
  private archetypes = new Map<string, Archetype>();

  registerModel(model: VoxelModel): void {
    this.models.set(model.id, model);
  }

  registerArchetype(archetype: Archetype): void {
    this.archetypes.set(archetype.id, archetype);
  }

  getModel(id: string): VoxelModel | undefined {
    return this.models.get(id);
  }

  resolveClip(
    archetypeId: string,
    state: string,
  ): { clipName: string; frameIds: string[] } | null {
    const arch = this.archetypes.get(archetypeId);
    if (!arch) return null;
    const st = arch.states[state];
    if (!st) return null;
    if (st.pool && st.pool.length > 0) {
      const pick = st.pool[Math.floor(Math.random() * st.pool.length)]!;
      return { clipName: pick.clip, frameIds: this.getFrameIds(pick.clip) };
    }
    return { clipName: st.clip, frameIds: this.getFrameIds(st.clip) };
  }

  private getFrameIds(clipName: string): string[] {
    for (const model of this.models.values()) {
      const clip = model.animations[clipName];
      if (clip) return clip.frames;
    }
    return [];
  }

  /** Advance animation on global anim step */
  stepAnimation(
    anim: AnimationState,
    archetypeId: string,
    animStep: number,
  ): { frameId: string; clipName: string } | null {
    if (anim.animStepSeen === animStep) return null;
    anim.animStepSeen = animStep;

    const resolved = this.resolveClip(archetypeId, anim.currentState);
    if (!resolved || resolved.frameIds.length === 0) return null;

    anim.clipName = resolved.clipName;
    anim.frameIndex = (anim.frameIndex + 1) % resolved.frameIds.length;
    return {
      frameId: resolved.frameIds[anim.frameIndex]!,
      clipName: resolved.clipName,
    };
  }

  setState(anim: AnimationState, state: string, archetypeId: string): void {
    if (anim.currentState === state) return;
    anim.currentState = state;
    anim.frameIndex = 0;
    anim.animStepSeen = -1;
    const resolved = this.resolveClip(archetypeId, state);
    if (resolved) anim.clipName = resolved.clipName;
  }
}
