import * as THREE from 'three';
import type { Archetype, VoxelModel, WorldSettings } from '@voxelbound/shared';
import { DEFAULT_WORLD_SETTINGS } from '@voxelbound/shared';
import { EventBus } from './core/EventBus';
import { SceneManager } from './core/SceneManager';
import { TickScheduler } from './core/TickScheduler';
import { World } from './ecs/World';
import { InputSystem } from './input/InputSystem';
import { GameCamera, setupLighting } from './render/GameCamera';
import { VoxelMeshCache } from './render/VoxelRenderer';
import { AnimationSystem } from './systems/AnimationSystem';
import { OverworldScene } from './scenes/OverworldScene';

export interface GameEngineOptions {
  canvas: HTMLCanvasElement;
  settings?: WorldSettings;
}

export class GameEngine {
  readonly bus = new EventBus();
  readonly scheduler: TickScheduler;
  readonly scenes = new SceneManager();
  readonly world = new World();
  readonly input = new InputSystem();
  readonly animation = new AnimationSystem();
  readonly meshCache = new VoxelMeshCache();
  readonly renderer: THREE.WebGLRenderer;
  readonly threeScene = new THREE.Scene();
  readonly camera: GameCamera;
  settings: WorldSettings;

  private running = false;
  private lastTime = 0;
  private detachInput: (() => void) | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private dir: THREE.DirectionalLight | null = null;

  constructor(options: GameEngineOptions) {
    this.settings = options.settings ?? DEFAULT_WORLD_SETTINGS;
    this.scheduler = new TickScheduler(this.settings.timing);
    this.camera = new GameCamera(this.settings);

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const lights = setupLighting(this.threeScene, this.settings.render);
    this.ambient = lights.ambient;
    this.dir = lights.dir;

    this.threeScene.background = new THREE.Color(0x6eb5ff);

    this.scheduler.onWorldTick((tick, dt) => {
      this.scenes.updateWorldTick(tick, dt);
      this.input.endFrame();
    });

    this.scheduler.onAnimStep((step) => {
      this.bus.emit('animStep', step);
    });
  }

  registerContent(models: VoxelModel[], archetypes: Archetype[]): void {
    models.forEach((m) => this.animation.registerModel(m));
    archetypes.forEach((a) => this.animation.registerArchetype(a));
  }

  initOverworld(): void {
    const scene = new OverworldScene(this);
    this.scenes.register(scene);
    this.scenes.switchTo('overworld');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.detachInput = this.input.attach();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    this.detachInput?.();
    window.removeEventListener('resize', this.resize);
  }

  applySettings(settings: WorldSettings): void {
    this.settings = settings;
    this.camera.applySettings(settings);
    if (this.ambient) this.ambient.intensity = settings.render.ambientIntensity;
    if (this.dir) this.dir.intensity = settings.render.dirLight.intensity;
  }

  private resize = (): void => {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.resize(w, h);
  };

  private loop = (now: number): void => {
    if (!this.running) return;
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.scheduler.update(delta);
    this.scenes.updateRender(0);
    this.renderer.render(this.threeScene, this.camera.camera);
    requestAnimationFrame(this.loop);
  };
}

export * from './core/EventBus';
export * from './core/SceneManager';
export * from './core/TickScheduler';
export * from './ecs/World';
export * from './input/InputSystem';
export * from './render/VoxelRenderer';
export * from './render/GameCamera';
export * from './systems/AnimationSystem';
