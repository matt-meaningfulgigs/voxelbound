import * as THREE from 'three';
import type { GameEngine } from '../GameEngine';
import type { Scene } from '../core/SceneManager';
import { buildStaticVoxels, VoxelMesh } from '../render/VoxelRenderer';

const GRASS_SWAY_FRAMES = ['sway_0', 'sway_1', 'sway_2'];

export class OverworldScene implements Scene {
  readonly id = 'overworld' as const;
  private engine: GameEngine;
  private playerId = 0;
  private playerMesh: VoxelMesh | null = null;
  private playerContainer = new THREE.Group();
  private grassMeshes: VoxelMesh[] = [];
  private animUnsub: (() => void) | null = null;
  private tickUnsub: (() => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  enter(): void {
    const { threeScene, world } = this.engine;
    threeScene.add(this.playerContainer);
    this.buildGround();
    this.spawnPlayer();
    this.spawnGrassField();

    this.animUnsub = this.engine.bus.on<number>('animStep', (step) => {
      this.onAnimStep(step);
    });

    this.tickUnsub = this.engine.scheduler.onWorldTick(() => this.onWorldTick());

    const t = world.stores.transform.get(this.playerId)!;
    this.engine.camera.follow(
      t.x,
      0,
      t.z,
      this.engine.settings.camera.followSmoothing,
    );
  }

  exit(): void {
    this.animUnsub?.();
    this.tickUnsub?.();
    this.engine.threeScene.remove(this.playerContainer);
    this.playerMesh?.dispose();
    this.grassMeshes.forEach((g) => g.dispose());
    this.grassMeshes = [];
  }

  updateWorldTick(_tick: number, _dt: number): void {}

  updateRender(_alpha: number): void {}

  private onWorldTick(): void {
    const { input, world, animation } = this.engine;
    const t = world.stores.transform.get(this.playerId);
    const m = world.stores.movement.get(this.playerId);
    const a = world.stores.animation.get(this.playerId);
    if (!t || !m || !a) return;

    const axis = input.getAxis();
    const speed = m.speed * (input.isHeld('run') ? m.runMultiplier : 1);
    m.vx = axis.x * speed;
    m.vz = axis.z * speed;
    m.moving = axis.x !== 0 || axis.z !== 0;

    t.x += m.vx;
    t.z += m.vz;

    if (m.moving) {
      if (Math.abs(axis.x) > Math.abs(axis.z)) {
        t.facing = axis.x > 0 ? 1 : 3;
      } else {
        t.facing = axis.z > 0 ? 2 : 0;
      }
      animation.setState(a, 'walk', 'townsperson');
    } else {
      animation.setState(a, 'idle', 'townsperson');
    }

    this.playerContainer.position.set(t.x, t.y, t.z);
    this.playerContainer.rotation.y = (t.facing * Math.PI) / 2;

    this.engine.camera.follow(
      t.x,
      0,
      t.z,
      this.engine.settings.camera.followSmoothing,
    );
  }

  private onAnimStep(step: number): void {
    const a = this.engine.world.stores.animation.get(this.playerId);
    if (!a) return;
    const result = this.engine.animation.stepAnimation(a, 'townsperson', step);
    if (result) this.refreshPlayerMesh(result.frameId);

    this.grassMeshes.forEach((mesh, i) => {
      const phase = (i * 7) % GRASS_SWAY_FRAMES.length;
      const frameIdx = (step + phase) % GRASS_SWAY_FRAMES.length;
      const model = this.engine.animation.getModel('grass_tile');
      if (model) mesh.buildFromModelFrame(model, GRASS_SWAY_FRAMES[frameIdx]!);
    });
  }

  private refreshPlayerMesh(frameId: string): void {
    const model = this.engine.animation.getModel('hero');
    if (!model) return;
    const key = `hero:${frameId}`;
    if (this.playerMesh) this.playerContainer.remove(this.playerMesh.group);
    this.playerMesh = this.engine.meshCache.getOrBake(
      key,
      model,
      frameId,
      this.engine.settings.render.voxelBevel,
    );
    this.playerContainer.add(this.playerMesh.group);
  }

  private spawnPlayer(): void {
    const id = this.engine.world.createEntity();
    this.playerId = id;
    this.engine.world.stores.transform.set(id, {
      x: 32,
      y: 0,
      z: 32,
      facing: 2,
    });
    this.engine.world.stores.movement.set(id, {
      speed: 0.15,
      runMultiplier: 1.8,
      vx: 0,
      vz: 0,
      moving: false,
    });
    this.engine.world.stores.animation.set(id, {
      currentState: 'idle',
      clipName: 'idle',
      frameIndex: 0,
      animStepSeen: -1,
      randomIdleTimer: 0,
    });
    this.engine.world.stores.voxelModel.set(id, { modelId: 'hero' });
    this.engine.world.stores.collider.set(id, {
      width: 14,
      depth: 14,
      solid: true,
    });
    this.refreshPlayerMesh('idle_0');
  }

  private buildGround(): void {
    const model = this.engine.animation.getModel('ground_tile');
    if (!model) return;
    const entries = model.frames['default'] ?? [];
    const voxels = entries.map(([x, y, z, ci]) => ({
      x,
      y,
      z,
      color: parseInt((model.palette[ci] ?? '#888888').replace('#', ''), 16),
    }));
    for (let gx = 0; gx < 8; gx++) {
      for (let gz = 0; gz < 8; gz++) {
        const tile = buildStaticVoxels(voxels);
        tile.position.set(gx * 16, 0, gz * 16);
        this.engine.threeScene.add(tile);
      }
    }
  }

  private spawnGrassField(): void {
    const model = this.engine.animation.getModel('grass_tile');
    if (!model) return;
    for (let i = 0; i < 12; i++) {
      const mesh = new VoxelMesh(this.engine.settings.render.voxelBevel);
      mesh.buildFromModelFrame(model, 'sway_0');
      mesh.group.position.set(40 + (i % 4) * 4, 0, 40 + Math.floor(i / 4) * 4);
      this.engine.threeScene.add(mesh.group);
      this.grassMeshes.push(mesh);
    }
  }
}
