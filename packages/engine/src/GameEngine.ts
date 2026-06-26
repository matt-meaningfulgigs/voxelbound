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
import { VoxelUIHost } from './render/VoxelUI';
import { AnimationSystem } from './systems/AnimationSystem';
import { OverworldScene } from './scenes/OverworldScene';
import { BattleScene } from './scenes/BattleScene';
import { GameState } from './state/GameState';
import { BattleSystem } from './systems/BattleSystem';

export interface GameEngineOptions {
  canvas: HTMLCanvasElement;
  settings?: WorldSettings;
  gameState?: GameState;
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
  readonly voxelUI: VoxelUIHost;
  settings: WorldSettings;

  readonly gs: GameState;
  readonly battle: BattleSystem;
  /** When true, overworld movement/AI/encounter logic is suspended (menus, dialogue, battle). */
  paused = false;
  /** Map currently built in the overworld scene ('overworld' or an interior id). */
  activeMapId = 'overworld';
  /** Spawn position applied next time the overworld scene is entered. */
  pendingSpawn: { x: number; z: number } | null = null;

  private running = false;
  private lastTime = 0;
  private detachInput: (() => void) | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private dir: THREE.DirectionalLight | null = null;

  constructor(options: GameEngineOptions) {
    this.settings = options.settings ?? DEFAULT_WORLD_SETTINGS;
    this.gs = options.gameState ?? new GameState();
    this.battle = new BattleSystem(this.gs);
    this.scheduler = new TickScheduler(this.settings.timing);
    this.camera = new GameCamera(this.settings);
    this.voxelUI = new VoxelUIHost();
    this.camera.camera.add(this.voxelUI.group);
    // Objects parented to the camera only render if the camera is in the scene graph.
    this.threeScene.add(this.camera.camera);

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
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

  battleScene!: BattleScene;
  overworldScene!: OverworldScene;

  initOverworld(): void {
    this.overworldScene = new OverworldScene(this);
    this.scenes.register(this.overworldScene);
    this.battleScene = new BattleScene(this);
    this.scenes.register(this.battleScene);
    this.scenes.switchTo('overworld');
  }

  /**
   * Project a screen-space point onto the world ground plane (y=0). Used by the
   * in-game World Editor to place props where the user clicks.
   */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, pt) ? { x: pt.x, z: pt.z } : null;
  }

  /** Load a map (town or interior) and place the player, rebuilding the scene. */
  goToMap(mapId: string, x?: number, z?: number): void {
    this.activeMapId = mapId;
    this.pendingSpawn = x !== undefined && z !== undefined ? { x, z } : null;
    this.scenes.switchTo('overworld');
  }

  /** Enter a battle for the given encounter id. Returns intro events for the UI. */
  goToBattle(encounterId: string): import('./systems/BattleSystem').BattleEvent[] {
    const intro = this.battle.start(encounterId);
    this.scenes.switchTo('battle');
    return intro;
  }

  /** Return to the current overworld map after a battle, keeping player position. */
  returnToOverworld(): void {
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
    this.scheduler.applyTiming(settings.timing);
    this.camera.applySettings(settings);
    if (this.ambient) this.ambient.intensity = settings.render.ambientIntensity;
    if (this.dir) this.dir.intensity = settings.render.dirLight.intensity;
  }

  aspect(): number {
    const w = this.renderer.domElement.clientWidth || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    return w / h;
  }

  private resize = (): void => {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.resize(w, h);
    this.voxelUI.resize(w, h);
  };

  private loop = (now: number): void => {
    if (!this.running) return;
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.scheduler.update(delta);
    this.scenes.updateRender(delta);
    this.syncWorldUI();
    this.renderer.render(this.threeScene, this.camera.camera);
    requestAnimationFrame(this.loop);
  };

  /**
   * Stand the voxel-UI slab upright in the world and park it in front of the
   * camera. Because the slab is a child of the camera, tilting it by the camera
   * pitch makes it a vertical wall in world space — so the isometric camera sees
   * it at exactly the same angle (and lighting) as the rest of the scene, while
   * it stays centred on screen and readable.
   */
  private syncWorldUI(): void {
    const g = this.voxelUI.group;
    if (!g.visible) return;
    // The UI slab is laid out to fill the overworld camera's frustum. Other
    // scenes (e.g. battle) reframe the shared camera to a different ortho size,
    // so scale the slab to whatever frustum the active camera is using now —
    // otherwise it renders far too large and only its empty centre is on-screen.
    const baseH = this.settings.camera.viewHeightVoxels * this.settings.camera.zoom;
    const cam = this.camera.camera;
    const frustumH = cam instanceof THREE.OrthographicCamera ? cam.top - cam.bottom : baseH;
    const s = baseH > 0 ? frustumH / baseH : 1;
    g.scale.setScalar(s);
    g.rotation.set(this.camera.pitchRad, 0, 0);
    g.position.set(0, 0, -frustumH * 0.55);
  }
}

export * from './core/EventBus';
export * from './core/SceneManager';
export * from './core/TickScheduler';
export * from './ecs/World';
export * from './input/InputSystem';
export * from './render/VoxelRenderer';
export * from './render/GameCamera';
export * from './systems/AnimationSystem';
export * from './state/EditorWorld';
