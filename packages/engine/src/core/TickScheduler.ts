import type { TimingConfig } from '@voxelbound/shared';
import { ticksPerAnimFrame } from '@voxelbound/shared';

export type WorldTickListener = (tick: number, dt: number) => void;
export type AnimStepListener = (animStep: number) => void;

export class TickScheduler {
  private timing: TimingConfig;
  private accumulator = 0;
  private worldTick = 0;
  private animTickCounter = 0;
  private animStep = 0;
  private tickInterval: number;
  private ticksPerFrame: number;
  private worldListeners = new Set<WorldTickListener>();
  private animListeners = new Set<AnimStepListener>();

  constructor(timing: TimingConfig) {
    this.timing = timing;
    this.tickInterval = 1 / timing.worldTickRate;
    this.ticksPerFrame = ticksPerAnimFrame(timing);
  }

  getTiming(): TimingConfig {
    return this.timing;
  }

  /** Hot-reload sim + animation clock rates from World Settings. */
  applyTiming(timing: TimingConfig): void {
    this.timing = timing;
    this.tickInterval = 1 / timing.worldTickRate;
    this.ticksPerFrame = ticksPerAnimFrame(timing);
    this.animTickCounter = 0;
  }

  onWorldTick(fn: WorldTickListener): () => void {
    this.worldListeners.add(fn);
    return () => this.worldListeners.delete(fn);
  }

  onAnimStep(fn: AnimStepListener): () => void {
    this.animListeners.add(fn);
    return () => this.animListeners.delete(fn);
  }

  update(deltaSeconds: number): void {
    this.accumulator += deltaSeconds;
    while (this.accumulator >= this.tickInterval) {
      this.accumulator -= this.tickInterval;
      this.worldTick++;
      const dt = this.tickInterval;
      this.worldListeners.forEach((fn) => fn(this.worldTick, dt));

      this.animTickCounter++;
      if (this.animTickCounter >= this.ticksPerFrame) {
        this.animTickCounter = 0;
        this.animStep++;
        this.animListeners.forEach((fn) => fn(this.animStep));
      }
    }
  }

  get currentWorldTick(): number {
    return this.worldTick;
  }

  get currentAnimStep(): number {
    return this.animStep;
  }
}
