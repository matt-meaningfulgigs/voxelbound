export type SceneId =
  | 'boot'
  | 'title'
  | 'overworld'
  | 'battle'
  | 'menu'
  | 'cutscene'
  | 'gameover';

export interface Scene {
  readonly id: SceneId;
  enter(): void;
  exit(): void;
  updateWorldTick(tick: number, dt: number): void;
  updateRender(alpha: number): void;
}

export class SceneManager {
  private scenes = new Map<SceneId, Scene>();
  private current: Scene | null = null;

  register(scene: Scene): void {
    this.scenes.set(scene.id, scene);
  }

  switchTo(id: SceneId): void {
    const next = this.scenes.get(id);
    if (!next) throw new Error(`Scene not registered: ${id}`);
    this.current?.exit();
    this.current = next;
    next.enter();
  }

  get active(): Scene | null {
    return this.current;
  }

  updateWorldTick(tick: number, dt: number): void {
    this.current?.updateWorldTick(tick, dt);
  }

  updateRender(alpha: number): void {
    this.current?.updateRender(alpha);
  }
}
