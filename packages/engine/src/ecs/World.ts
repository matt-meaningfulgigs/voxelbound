export interface Transform {
  x: number;
  y: number;
  z: number;
  facing: 0 | 1 | 2 | 3;
}

export interface VoxelModelRef {
  modelId: string;
}

export interface AnimationState {
  currentState: string;
  clipName: string;
  frameIndex: number;
  animStepSeen: number;
  randomIdleTimer: number;
}

export interface Movement {
  speed: number;
  runMultiplier: number;
  vx: number;
  vz: number;
  moving: boolean;
}

export interface Collider {
  width: number;
  depth: number;
  solid: boolean;
}

export type ComponentMap = {
  transform: Transform;
  voxelModel: VoxelModelRef;
  animation: AnimationState;
  movement: Movement;
  collider: Collider;
};

export type ComponentName = keyof ComponentMap;

export class ComponentStore<K extends ComponentName> {
  private data = new Map<number, ComponentMap[K]>();

  set(entity: number, value: ComponentMap[K]): void {
    this.data.set(entity, value);
  }

  get(entity: number): ComponentMap[K] | undefined {
    return this.data.get(entity);
  }

  delete(entity: number): void {
    this.data.delete(entity);
  }

  entries(): IterableIterator<[number, ComponentMap[K]]> {
    return this.data.entries();
  }
}

export class World {
  private nextId = 1;
  stores: { [K in ComponentName]: ComponentStore<K> } = {
    transform: new ComponentStore<'transform'>(),
    voxelModel: new ComponentStore<'voxelModel'>(),
    animation: new ComponentStore<'animation'>(),
    movement: new ComponentStore<'movement'>(),
    collider: new ComponentStore<'collider'>(),
  };

  createEntity(): number {
    return this.nextId++;
  }

  destroyEntity(id: number): void {
    (Object.keys(this.stores) as ComponentName[]).forEach((k) =>
      this.stores[k].delete(id),
    );
  }
}
