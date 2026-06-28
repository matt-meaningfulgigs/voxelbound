import * as THREE from 'three';
import {
  INTERIOR_BY_ID,
  OVERWORLD_ENCOUNTER_TABLE,
  treeModelIds,
  pineModelIds,
  generateTerrain,
  heightBilinear,
  walkableAt,
  Rng,
  hashSeed,
  DEFAULT_OVERWORLD,
  SurfaceCover,
  townBuildings,
  generateBuildingModel,
  generateInterior,
  interiorSpawn,
  generateCharacter,
  TerrainMaterial,
  type SizeClass,
  type BuildingSpec,
  type InteriorMap,
  type TerrainField,
} from '@voxelbound/shared';
import type { GameEngine } from '../GameEngine';
import type { Scene } from '../core/SceneManager';
import { VoxelMesh } from '../render/VoxelRenderer';
import { buildTerrainMeshes } from '../render/ChunkMesher';
import { GrassLayer } from '../render/GrassLayer';
import { NavGrid, findPath, type NavPoint } from '../systems/Pathfinding';
import { WaterFeatures, type RiverPoint } from '../systems/WaterFeatures';
import { EmitterEffects } from '../systems/EmitterEffects';
import { EditorWorld } from '../state/EditorWorld';

const SWAY = ['sway_0', 'sway_1', 'sway_2'];

interface NpcBrain {
  mode: 'wander' | 'route';
  homeX: number;
  homeZ: number;
  radius: number;
  speed: number;
  path: NavPoint[] | null;
  pathIdx: number;
  stuck: number;
  waitTimer: number;
  repathCooldown: number;
  route?: NavPoint[];
  routeIdx: number;
  routeDir: 1 | -1;
  routeLoop: 'loop' | 'pingpong' | 'once';
  routePause: number;
  done?: boolean;
}

interface Actor {
  id: number;
  container: THREE.Group;
  modelId: string;
  archetype: string;
  mesh: VoxelMesh;
  hw: number;
  hd: number;
  isPlayer: boolean;
  dialogue?: string;
  homeFacing?: 0 | 1 | 2 | 3;
  ai?: NpcBrain;
}

interface AnimatedProp {
  container: THREE.Group;
  meshes: VoxelMesh[];
  phase: number;
  current: number;
}

interface Solid {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Interactable {
  x: number;
  z: number;
  r: number;
  dialogue: string;
  actor?: Actor;
}

interface Door {
  x: number;
  z: number;
  r: number;
  toMap: string;
  toX: number;
  toZ: number;
  enterFacing?: 0 | 1 | 2 | 3;
}

interface EncounterZone {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  table: string[];
}

export class OverworldScene implements Scene {
  readonly id = 'overworld' as const;
  private engine: GameEngine;

  private mapW = 512;
  private mapD = 512;
  private cx = 256;
  private cz = 256;
  private isInterior = false;

  private actors: Actor[] = [];
  private player!: Actor;
  private animatedProps: AnimatedProp[] = [];
  private water: WaterFeatures | null = null;
  private emitters: EmitterEffects | null = null;
  private riverPath: RiverPoint[] = [];
  private staticProps: VoxelMesh[] = [];
  private staticContainers: THREE.Group[] = [];
  private terrain: THREE.Mesh[] = [];
  private terrainField: TerrainField | null = null;
  private seaLevel = DEFAULT_OVERWORLD.seaLevel;
  private cover: SurfaceCover | null = null;
  private grass: GrassLayer | null = null;
  private navGrid: NavGrid | null = null;
  private buildingSpecs: BuildingSpec[] | null = null;
  private buildingSpecsSeed = NaN;
  private registeredBuildings = new Set<string>();
  private solids: Solid[] = [];
  private interactables: Interactable[] = [];
  private doors: Door[] = [];
  private encounterZone: EncounterZone | null = null;

  private talkingActor: Actor | null = null;
  private doorCooldown = 0;
  private interactCooldown = 0;
  private stepAccum = 0;

  private animUnsub: (() => void) | null = null;
  private dialogueEndUnsub: (() => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  enter(): void {
    const mapId = this.engine.activeMapId;
    this.engine.gs.data.map = mapId;
    this.isInterior = mapId !== 'overworld';

    if (this.isInterior) this.buildInterior(mapId);
    else this.buildTown();

    const spawn = this.resolveSpawn(mapId);
    this.spawnPlayer(spawn.x, spawn.z);
    this.doorCooldown = 18;

    // restore overworld camera framing (battle may have changed it)
    this.engine.camera.applySettings(this.engine.settings);
    this.engine.threeScene.background = this.isInterior
      ? new THREE.Color(0x1a1620)
      : this.skyTexture();

    this.animUnsub = this.engine.bus.on<number>('animStep', (s) => this.onAnimStep(s));
    this.dialogueEndUnsub = this.engine.bus.on('dialogue:end', () => {
      this.endTalk();
      this.interactCooldown = 14;
    });

    this.engine.camera.follow(spawn.x, this.groundHeight(spawn.x, spawn.z), spawn.z, 1);
  }

  exit(): void {
    this.animUnsub?.();
    this.dialogueEndUnsub?.();
    this.actors.forEach((a) => {
      a.mesh.dispose();
      this.engine.threeScene.remove(a.container);
    });
    this.animatedProps.forEach((p) => {
      this.engine.threeScene.remove(p.container);
      p.meshes.forEach((m) => m.dispose());
    });
    this.staticProps.forEach((m) => m.dispose());
    this.staticContainers.forEach((c) => this.engine.threeScene.remove(c));
    this.terrain.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.engine.threeScene.remove(m);
    });
    this.actors = [];
    this.animatedProps = [];
    this.staticProps = [];
    this.staticContainers = [];
    this.terrain = [];
    this.solids = [];
    this.interactables = [];
    this.doors = [];
    this.encounterZone = null;
    this.talkingActor = null;
    this.water?.dispose();
    this.water = null;
    this.emitters?.dispose();
    this.emitters = null;
    this.riverPath = [];
    this.grass?.dispose();
    this.grass = null;
    this.cover = null;
    this.navGrid = null;
    this.terrainField = null;
    this.customStack = [];
  }

  private _sky: THREE.CanvasTexture | null = null;
  /** Vertical gradient sky (warm horizon → blue zenith) for the overworld. */
  private skyTexture(): THREE.CanvasTexture {
    if (this._sky) return this._sky;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#8fc7ff'); // zenith
    grad.addColorStop(0.6, '#bfe0ff');
    grad.addColorStop(1, '#f2e6c4'); // warm horizon haze
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    this._sky = new THREE.CanvasTexture(c);
    this._sky.colorSpace = THREE.SRGBColorSpace;
    return this._sky;
  }

  /** Surface height at a world position (0 indoors where the floor is flat). */
  private groundHeight(x: number, z: number): number {
    if (this.terrainField && !this.isInterior) return heightBilinear(this.terrainField, x, z);
    return 0;
  }

  updateWorldTick(): void {
    this.tick();
  }
  updateRender(dt: number): void {
    if (!this.isInterior && this.terrainField) this.applyViewCulling();
    this.water?.render(dt);
    this.emitters?.render(dt);
  }

  /** Hide props/NPCs and tighten water sim to the visible footprint. */
  private applyViewCulling(): void {
    const cam = this.engine.camera;
    const r = cam.viewCullRadius();
    this.water?.setViewCullRadius(r);
    this.emitters?.setViewCullRadius(r);

    const t = this.engine.world.stores.transform.get(this.player.id);
    if (t) this.emitters?.setViewCenter(t.x, t.z);

    for (const c of this.staticContainers) {
      c.visible = cam.containsXZ(c.position.x, c.position.z);
    }
    for (const p of this.animatedProps) {
      p.container.visible = cam.containsXZ(p.container.position.x, p.container.position.z);
    }
    for (const a of this.actors) {
      if (a.isPlayer) {
        a.container.visible = true;
        continue;
      }
      const at = this.engine.world.stores.transform.get(a.id);
      a.container.visible = at ? cam.containsXZ(at.x, at.z) : false;
    }
  }

  private resolveSpawn(mapId: string): { x: number; z: number } {
    if (this.engine.pendingSpawn) {
      const s = this.engine.pendingSpawn;
      this.engine.pendingSpawn = null;
      return s;
    }
    const gs = this.engine.gs;
    if (gs.data.playerX || gs.data.playerZ) return { x: gs.data.playerX, z: gs.data.playerZ };
    if (mapId === 'overworld') return { x: this.cx + 36, z: this.cz + 70 };
    return { x: this.mapW / 2, z: this.mapD - 18 };
  }

  // -- per-tick -------------------------------------------------------------

  private tick(): void {
    if (this.engine.paused) {
      // keep camera centered even while paused so menus don't jitter the view
      const t = this.engine.world.stores.transform.get(this.player.id);
      if (t) this.engine.camera.follow(t.x, this.groundHeight(t.x, t.z), t.z, 1);
      return;
    }
    this.updatePlayer();
    this.updateNpcs();
    if (this.doorCooldown > 0) this.doorCooldown -= 1;
    if (this.interactCooldown > 0) this.interactCooldown -= 1;

    const t = this.engine.world.stores.transform.get(this.player.id)!;
    this.engine.gs.data.playerX = t.x;
    this.engine.gs.data.playerZ = t.z;
    this.engine.gs.data.playTimeMs += 1000 / this.engine.settings.timing.worldTickRate;
    this.engine.camera.follow(t.x, this.groundHeight(t.x, t.z), t.z, this.engine.settings.camera.followSmoothing);

    this.water?.step(1 / this.engine.settings.timing.worldTickRate, { x: t.x, z: t.z });
    if (this.terrainField) {
      this.water?.setViewCullRadius(this.engine.camera.viewCullRadius());
    }
    this.cover?.tick();
    this.grass?.update();

    this.checkDoors(t);
    this.checkEncounter(t);
    if (this.interactCooldown === 0 && (this.engine.input.wasPressed('talk') || this.engine.input.wasPressed('confirm'))) this.tryInteract(t);
    if (this.engine.input.wasPressed('menu')) this.engine.bus.emit('menu:open');
  }

  private updatePlayer(): void {
    const { input, world, animation } = this.engine;
    const a = this.player;
    const t = world.stores.transform.get(a.id)!;
    const m = world.stores.movement.get(a.id)!;
    const an = world.stores.animation.get(a.id)!;

    const axis = input.getAxis();
    const speed = m.speed * (input.isHeld('run') ? m.runMultiplier : 1);
    const vx = axis.x * speed;
    const vz = axis.z * speed;
    const moving = axis.x !== 0 || axis.z !== 0;

    const before = { x: t.x, z: t.z };
    this.tryMove(t, vx, vz, a.hw, a.hd, a.id);
    this.stepAccum += Math.hypot(t.x - before.x, t.z - before.z);

    if (moving) {
      if (Math.abs(axis.x) > Math.abs(axis.z)) t.facing = axis.x > 0 ? 1 : 3;
      else t.facing = axis.z > 0 ? 2 : 0;
      animation.setState(an, 'walk', a.archetype);
      this.cover?.stamp(t.x, t.z, t.facing);
      // splash / ripple when wading through any live water (self-gates if dry)
      this.water?.wade(t.x, t.z, 1 / this.engine.settings.timing.worldTickRate);
    } else {
      animation.setState(an, 'idle', a.archetype);
    }
    this.syncActor(a, t);
  }

  private updateNpcs(): void {
    const { world, animation } = this.engine;
    for (const a of this.actors) {
      if (a.isPlayer || !a.ai) continue;
      if (a === this.talkingActor) {
        animation.setState(world.stores.animation.get(a.id)!, 'idle', a.archetype);
        continue;
      }
      const t = world.stores.transform.get(a.id)!;
      const an = world.stores.animation.get(a.id)!;
      const ai = a.ai;

      if (ai.waitTimer > 0) {
        ai.waitTimer -= 1;
        animation.setState(an, 'idle', a.archetype);
        this.syncActor(a, t);
        continue;
      }

      // Need a new path? (none, or finished current one)
      if (!ai.path || ai.pathIdx >= ai.path.length) {
        this.planNextPath(a, t);
        if (!ai.path) {
          animation.setState(an, 'idle', a.archetype);
          this.syncActor(a, t);
          continue;
        }
      }

      // Follow current path
      const wp = ai.path[ai.pathIdx]!;
      const dx = wp.x - t.x;
      const dz = wp.z - t.z;
      const dlen = Math.hypot(dx, dz);
      if (dlen < ai.speed * 1.5) {
        ai.pathIdx += 1;
        animation.setState(an, 'idle', a.archetype);
        this.syncActor(a, t);
        continue;
      }

      const vx = (dx / dlen) * ai.speed;
      const vz = (dz / dlen) * ai.speed;
      const before = { x: t.x, z: t.z };
      this.tryMove(t, vx, vz, a.hw, a.hd, a.id);
      if (Math.abs(vx) > Math.abs(vz)) t.facing = vx > 0 ? 1 : 3;
      else t.facing = vz > 0 ? 2 : 0;

      const moved = Math.hypot(t.x - before.x, t.z - before.z);
      if (moved < ai.speed * 0.3) {
        // blocked (likely a dynamic actor) — wait briefly, then repath
        ai.stuck += 1;
        if (ai.stuck > 8) {
          ai.path = null;
          ai.stuck = 0;
          ai.waitTimer = 6 + Math.floor(Math.random() * 10);
        }
        animation.setState(an, 'idle', a.archetype);
      } else {
        ai.stuck = 0;
        animation.setState(an, 'walk', a.archetype);
        this.cover?.stamp(t.x, t.z, t.facing);
      }
      this.syncActor(a, t);
    }
  }

  /** Choose the next destination (route waypoint or wander target) and path to it. */
  private planNextPath(a: Actor, t: { x: number; z: number }): void {
    const ai = a.ai!;
    const grid = this.navGrid;
    if (!grid) {
      ai.path = null;
      return;
    }

    let target: NavPoint | null = null;
    if (ai.mode === 'route' && ai.route && ai.route.length > 0) {
      const cur = ai.route[ai.routeIdx]!;
      if (Math.hypot(t.x - cur.x, t.z - cur.z) < ai.speed * 6) {
        this.advanceRoute(ai);
        ai.waitTimer = ai.routePause;
        if (ai.done) {
          ai.path = null;
          return;
        }
      }
      target = ai.route[ai.routeIdx]!;
    } else {
      // wander: idle, then pick a reachable point near home
      if (ai.repathCooldown > 0) {
        ai.repathCooldown -= 1;
        ai.path = null;
        return;
      }
      const ang = Math.random() * Math.PI * 2;
      const dist = ai.radius * (0.4 + Math.random() * 0.6);
      target = { x: ai.homeX + Math.cos(ang) * dist, z: ai.homeZ + Math.sin(ang) * dist };
      ai.repathCooldown = 40 + Math.floor(Math.random() * 90);
    }

    if (!target) {
      ai.path = null;
      return;
    }
    const path = findPath(grid, t.x, t.z, target.x, target.z);
    if (path && path.length > 1) {
      ai.path = path;
      ai.pathIdx = 1; // skip the cell we're already in
    } else {
      ai.path = null;
      ai.waitTimer = 20;
    }
  }

  private advanceRoute(ai: NpcBrain): void {
    const route = ai.route!;
    const n = route.length;
    if (n <= 1) return;
    if (ai.routeLoop === 'pingpong') {
      let ni = ai.routeIdx + ai.routeDir;
      if (ni >= n) {
        ai.routeDir = -1;
        ni = n - 2;
      } else if (ni < 0) {
        ai.routeDir = 1;
        ni = 1;
      }
      ai.routeIdx = Math.max(0, Math.min(n - 1, ni));
    } else if (ai.routeLoop === 'once') {
      if (ai.routeIdx < n - 1) ai.routeIdx += 1;
      else ai.done = true;
    } else {
      ai.routeIdx = (ai.routeIdx + 1) % n;
    }
  }

  private syncActor(a: Actor, t: { x: number; y: number; z: number; facing: number }): void {
    a.container.position.set(t.x, this.groundHeight(t.x, t.z), t.z);
    a.container.rotation.y = (t.facing * Math.PI) / 2;
  }

  // -- interaction ----------------------------------------------------------

  private tryInteract(t: { x: number; z: number; facing: number }): void {
    // a point just in front of the player based on facing
    const fx = t.x + (t.facing === 1 ? 12 : t.facing === 3 ? -12 : 0);
    const fz = t.z + (t.facing === 2 ? 12 : t.facing === 0 ? -12 : 0);
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      // moving NPCs: test against their live position, not their spawn
      let ix = it.x;
      let iz = it.z;
      if (it.actor) {
        const at = this.engine.world.stores.transform.get(it.actor.id);
        if (at) {
          ix = at.x;
          iz = at.z;
        }
      }
      const d = Math.min(Math.hypot(ix - fx, iz - fz), Math.hypot(ix - t.x, iz - t.z));
      if (d < it.r && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    if (!best) return;
    if (best.actor) {
      this.talkingActor = best.actor;
      const at = this.engine.world.stores.transform.get(best.actor.id);
      if (at) {
        at.facing = this.facingToward(at.x, at.z, t.x, t.z);
        this.syncActor(best.actor, at);
        const an = this.engine.world.stores.animation.get(best.actor.id);
        if (an) this.engine.animation.setState(an, 'talk', best.actor.archetype);
      }
    }
    this.engine.bus.emit('npc:talk', { dialogue: best.dialogue });
  }

  private endTalk(): void {
    if (!this.talkingActor) return;
    const an = this.engine.world.stores.animation.get(this.talkingActor.id);
    if (an) this.engine.animation.setState(an, 'idle', this.talkingActor.archetype);
    this.talkingActor = null;
  }

  private facingToward(fromX: number, fromZ: number, toX: number, toZ: number): 0 | 1 | 2 | 3 {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
    return dz > 0 ? 2 : 0;
  }

  private checkDoors(t: { x: number; z: number; facing: number }): void {
    if (this.doorCooldown > 0) return;
    for (const d of this.doors) {
      if (Math.hypot(d.x - t.x, d.z - t.z) >= d.r) continue;
      // facing-gated doors require the player to walk into the doorway
      if (d.enterFacing != null && t.facing !== d.enterFacing) continue;
      this.engine.bus.emit('door:enter', { toMap: d.toMap, toX: d.toX, toZ: d.toZ });
      return;
    }
  }

  private checkEncounter(t: { x: number; z: number }): void {
    const z = this.encounterZone;
    if (!z) return;
    const inside = t.x >= z.x0 && t.x <= z.x1 && t.z >= z.z0 && t.z <= z.z1;
    if (!inside) return;
    if (this.stepAccum > 14) {
      this.stepAccum = 0;
      if (Math.random() < 0.16) {
        const enc = this.pickEncounter(z.table);
        this.engine.bus.emit('encounter', { encounterId: enc });
      }
    }
  }

  private pickEncounter(table: string[]): string {
    return table[Math.floor(Math.random() * table.length)] ?? table[0]!;
  }

  // -- collision ------------------------------------------------------------

  private boxesOverlap(ax: number, az: number, ahw: number, ahd: number, bx: number, bz: number, bhw: number, bhd: number): boolean {
    return ax + ahw > bx - bhw && ax - ahw < bx + bhw && az + ahd > bz - bhd && az - ahd < bz + bhd;
  }

  private terrainBlocked(x: number, z: number, hw: number, hd: number): boolean {
    const f = this.terrainField;
    if (!f || this.isInterior) {
      return x - hw < 4 || x + hw > this.mapW - 4 || z - hd < 4 || z + hd > this.mapD - 4;
    }
    const sx = hw * 0.7;
    const sz = hd * 0.7;
    const pass = (px: number, pz: number): boolean => {
      if (walkableAt(f, px, pz)) return true;
      return (this.water?.depthAt(px, pz) ?? 0) >= 0.35;
    };
    return (
      !pass(x, z) ||
      !pass(x + sx, z + sz) ||
      !pass(x - sx, z + sz) ||
      !pass(x + sx, z - sz) ||
      !pass(x - sx, z - sz)
    );
  }

  private collides(x: number, z: number, hw: number, hd: number, ignoreId?: number): boolean {
    if (this.terrainBlocked(x, z, hw, hd)) return true;
    for (const s of this.solids) {
      if (x + hw > s.x0 && x - hw < s.x1 && z + hd > s.z0 && z - hd < s.z1) return true;
    }
    for (const a of this.actors) {
      if (a.id === ignoreId) continue;
      const other = this.engine.world.stores.transform.get(a.id);
      if (!other) continue;
      if (this.boxesOverlap(x, z, hw, hd, other.x, other.z, a.hw, a.hd)) return true;
    }
    return false;
  }

  private tryMove(t: { x: number; z: number }, vx: number, vz: number, hw: number, hd: number, ignoreId?: number): void {
    if (vx !== 0 && !this.collides(t.x + vx, t.z, hw, hd, ignoreId)) t.x += vx;
    if (vz !== 0 && !this.collides(t.x, t.z + vz, hw, hd, ignoreId)) t.z += vz;
  }

  // -- animation step -------------------------------------------------------

  private onAnimStep(step: number): void {
    const { world, animation } = this.engine;
    for (const a of this.actors) {
      const an = world.stores.animation.get(a.id);
      if (!an) continue;
      const res = animation.stepAnimation(an, a.archetype, step);
      if (res) a.mesh.buildFromModelFrame(animation.getModel(a.modelId)!, res.frameId);
    }
    for (const p of this.animatedProps) {
      const idx = (step + p.phase) % p.meshes.length;
      if (idx === p.current) continue;
      p.meshes[p.current]!.group.visible = false;
      p.meshes[idx]!.group.visible = true;
      p.current = idx;
    }
  }

  // -- terrain helpers ------------------------------------------------------

  private slab(cx: number, cz: number, w: number, d: number, topY: number, thick: number, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(cx, topY - thick / 2, cz);
    this.engine.threeScene.add(mesh);
    this.terrain.push(mesh);
    return mesh;
  }

  private getStaticFrame(modelId: string): string {
    const model = this.engine.animation.getModel(modelId);
    if (model && model.animations['sway']) return 'sway_0';
    return 'default';
  }

  private placeProp(modelId: string, x: number, z: number, facing = 0, animated = false, yOffset = 0): { container: THREE.Group; meshes: VoxelMesh[] } | null {
    const model = this.engine.animation.getModel(modelId);
    if (!model) return null;
    const [pvx, , pvz] = model.pivot;
    const container = new THREE.Group();
    container.position.set(x, this.groundHeight(x, z) + yOffset, z);
    container.rotation.y = (facing * Math.PI) / 2;
    const meshes: VoxelMesh[] = [];
    if (animated) {
      const swayMeshes = SWAY.map((f) => {
        const m = new VoxelMesh(this.engine.settings.render.voxelBevel);
        m.buildFromModelFrame(model, f);
        m.group.position.set(-pvx, 0, -pvz);
        m.group.visible = false;
        container.add(m.group);
        return m;
      });
      swayMeshes[0]!.group.visible = true;
      meshes.push(...swayMeshes);
      this.animatedProps.push({ container, meshes: swayMeshes, phase: Math.floor(Math.random() * SWAY.length), current: 0 });
    } else {
      const m = new VoxelMesh(this.engine.settings.render.voxelBevel);
      m.buildFromModelFrame(model, this.getStaticFrame(modelId));
      m.group.position.set(-pvx, 0, -pvz);
      container.add(m.group);
      this.staticProps.push(m);
      meshes.push(m);
    }
    this.engine.threeScene.add(container);
    this.staticContainers.push(container);
    return { container, meshes };
  }

  // -- in-game World Editor API --------------------------------------------

  private customStack: Array<{ container: THREE.Group; meshes: VoxelMesh[]; solid?: Solid }> = [];

  private hasSway(modelId: string): boolean {
    return !!this.engine.animation.getModel(modelId)?.animations['sway'];
  }

  /** Place a prop from the editor; optionally adds collision and persists it. */
  placeCustom(modelId: string, x: number, z: number, facing = 0, solid = true, persist = true): boolean {
    const created = this.placeProp(modelId, x, z, facing, this.hasSway(modelId));
    if (!created) return false;
    let s: Solid | undefined;
    if (solid) {
      const model = this.engine.animation.getModel(modelId)!;
      const half = Math.max(model.bounds[0], model.bounds[2]) / 2 - 1;
      s = { x0: x - half, z0: z - half, x1: x + half, z1: z + half };
      this.solids.push(s);
    }
    this.customStack.push({ container: created.container, meshes: created.meshes, solid: s });
    if (persist) EditorWorld.add(this.engine.activeMapId, { modelId, x, z, facing, solid });
    return true;
  }

  /** Remove the most recently placed editor prop (live + persisted). */
  removeLastCustom(): boolean {
    const last = this.customStack.pop();
    if (!last) return false;
    this.engine.threeScene.remove(last.container);
    last.meshes.forEach((m) => m.dispose());
    if (last.solid) this.solids = this.solids.filter((s) => s !== last.solid);
    EditorWorld.removeLast(this.engine.activeMapId);
    return true;
  }

  private applyCustomPlacements(mapId: string): void {
    for (const p of EditorWorld.get(mapId)) {
      this.placeCustom(p.modelId, p.x, p.z, p.facing, p.solid ?? true, false);
    }
  }

  // -- town -----------------------------------------------------------------

  /** Deterministic town building layout for the current world seed (memoized). */
  private townSpecs(): BuildingSpec[] {
    const seed = this.engine.gs.data.worldSeed;
    if (!this.buildingSpecs || this.buildingSpecsSeed !== seed) {
      this.buildingSpecs = townBuildings(seed);
      this.buildingSpecsSeed = seed;
    }
    return this.buildingSpecs;
  }

  /** Register procedural building models in the animation system on demand. */
  private ensureBuildingModel(spec: BuildingSpec): void {
    if (this.registeredBuildings.has(spec.id)) return;
    this.engine.animation.registerModel(generateBuildingModel(spec));
    this.registeredBuildings.add(spec.id);
  }

  private buildTown(): void {
    this.mapW = 512;
    this.mapD = 512;
    this.cx = 256;
    this.cz = 256;
    const CX = this.cx;
    const CZ = this.cz;

    this.buildTownTerrain();

    // Central pagan effigy — burning wicker man with voxel fire + smoke
    this.placeProp('burning_effigy', CX, CZ);
    const effigy = this.engine.animation.getModel('burning_effigy');
    if (effigy) {
      const effigyHalf = Math.max(effigy.bounds[0], effigy.bounds[2]) / 2 - 3;
      this.solids.push({ x0: CX - effigyHalf, z0: CZ - effigyHalf, x1: CX + effigyHalf, z1: CZ + effigyHalf });
      const baseY = this.groundHeight(CX, CZ);
      this.emitters?.addPropSources(effigy, 'default', CX, baseY, CZ, 0);
    }

    // Fountain moved to east plaza — still seeds dynamic water
    const fx = CX + 88;
    const fz = CZ - 42;
    this.placeProp('fountain', fx, fz);
    this.solids.push({ x0: fx - 2.5, z0: fz - 2.5, x1: fx + 2.5, z1: fz + 2.5 });
    this.addFountainWater(fx, fz);
    const fountainModel = this.engine.animation.getModel('fountain');
    if (fountainModel) {
      const fBase = this.groundHeight(fx, fz);
      this.water?.addPropWaterEmitters(fountainModel, 'default', fx, fBase, fz, 0);
    }
    this.seedWorldWater();
    if (this.terrainField) this.water?.markTerrainWalkable(this.terrainField);
    for (const [dx, dz] of [[-52, -52], [52, -52], [-52, 52], [52, 52]] as const) this.placeProp('lamp', CX + dx, CZ + dz);

    // procedural town buildings — every one is enterable
    for (const spec of this.townSpecs()) this.addBuilding(spec);
    // little signs marking the shops
    this.placeProp('sign', 152, 196);
    this.placeProp('sign', 232, 196);

    // stacked alley clutter (boxes on dumpsters, etc.)
    this.placeStack([{ modelId: 'dumpster' }, { modelId: 'crate', dz: -1 }], 170, 188);
    this.placeStack([{ modelId: 'trashcan' }, { modelId: 'crate' }], 252, 185);
    this.placeStack([{ modelId: 'barrel' }, { modelId: 'crate' }], 344, 188);
    this.placeStack([{ modelId: 'crate' }, { modelId: 'crate', dx: 1 }, { modelId: 'barrel' }], 168, 330);
    this.placeStack([{ modelId: 'dumpster', facing: 1 }, { modelId: 'barrel' }], 344, 330);
    this.placeStack([{ modelId: 'trashcan' }], 286, 330);

    // scripted story NPCs (keep recognizable hand-tuned villager looks)
    this.addNpc('villager_pink', CX - 6, CZ + 40, 0, 'mara', false, 1.0);
    this.addNpc('villager_green', CX + 10, CZ + 96, 0, 'greeter', true, 1.0);
    this.addNpc('villager_orange', 210, 300, 2, 'pip_recruit', false, 1.0);
    // ambient wanderers — a diverse seeded crowd (child/adult/tall/large)
    this.addTownsfolk('t1', 120, 300, 1, 'townsfolk_1', 'child');
    this.addTownsfolk('t2', 360, 320, 3, 'townsfolk_2', 'large');
    this.addTownsfolk('t3', 300, 300, 0, 'townsfolk_3', 'child');
    this.addTownsfolk('t4', 180, 230, 2, 'townsfolk_4', 'tall');
    this.addTownsfolk('t5', 330, 220, 1, 'townsfolk_5');
    this.addTownsfolk('t6', 230, 240, 2, 'townsfolk_1');
    this.addTownsfolk('t7', 280, 220, 0, 'townsfolk_4', 'large');
    this.addTownsfolk('t8', 160, 280, 1, 'townsfolk_2', 'tall');
    this.addTownsfolk('t9', 340, 290, 3, 'townsfolk_5', 'child');

    // town sign + meadow locket
    this.addSign(CX + 22, CZ + 116, 'sign_town');
    this.placeProp('sign', CX + 22, CZ + 116);
    this.addSpecial(450, 280, 'meadow_locket');
    this.placeProp('lamp', 450, 280);

    // nature + meadow grass
    this.scatterNature();

    // eastern meadow encounter zone
    this.encounterZone = { x0: 360, z0: 200, x1: 500, z1: 360, table: OVERWORLD_ENCOUNTER_TABLE };

    this.applyCustomPlacements('overworld');

    // nav grid for NPC pathfinding (after all static solids exist)
    if (this.terrainField) this.navGrid = new NavGrid(this.terrainField, this.solids, 4);

    // scripted patrols around the plaza (smart-path around obstacles)
    const guard = this.genTownsfolk('guard', 'tall');
    this.addRoutedNpc(guard.modelId, 'townsfolk_3', [
      { x: CX - 70, z: CZ - 40 },
      { x: CX + 70, z: CZ - 40 },
      { x: CX + 70, z: CZ + 70 },
      { x: CX - 70, z: CZ + 70 },
    ], 'loop', 30, guard.scale);
    const merchant = this.genTownsfolk('merchant', 'large');
    this.addRoutedNpc(merchant.modelId, 'townsfolk_5', [
      { x: 150, z: 250 },
      { x: 360, z: 250 },
    ], 'pingpong', 50, merchant.scale);
  }

  private buildTownTerrain(): void {
    const def = {
      ...DEFAULT_OVERWORLD,
      seed: this.engine.gs.data.worldSeed,
      w: this.mapW,
      d: this.mapD,
    };
    const field = generateTerrain(def);
    this.terrainField = field;
    this.seaLevel = def.seaLevel;

    // Carve a sunken street grid into the flat town core. Roads sit one voxel
    // below the grass, so the chunk mesher renders a raised curb / 3D step.
    this.carveStreets(field, def.coreLevel);
    // Flatten a level pad under each building so they sit flush, and keep the
    // doorway apron walkable so every door is reachable.
    this.carveBuildingPads(field, def.coreLevel);
    // Sculpt a river valley with a waterfall running down to the SW lake.
    this.carveRiver(field);

    for (const m of buildTerrainMeshes(field, 64)) {
      this.engine.threeScene.add(m);
      this.terrain.push(m);
    }

    // Live shallow-water fluid sim: fountain, river and lake flow/ripple/splash.
    this.water = new WaterFeatures(this.engine.threeScene, field);
    this.emitters = new EmitterEffects(this.engine.threeScene);

    this.cover = new SurfaceCover(field);
    this.grass = new GrassLayer(this.engine.threeScene, field, this.cover, this.engine.gs.data.worldSeed, {
      townCenterX: this.cx,
      townCenterZ: this.cz,
      townRadius: 115,
    });
  }

  /** Raised plaza fountain: simulated basin + bowl pools, spout and spray. */
  private addFountainWater(cx: number, cz: number): void {
    const baseY = this.groundHeight(cx, cz);
    this.water?.seedFountain(cx, cz, baseY);
  }

  /** River channel + every submerged column (ocean, lakes, coastlines). */
  private seedWorldWater(): void {
    if (!this.terrainField) return;
    if (this.riverPath.length) this.water?.seedRiver(this.riverPath);
    this.water?.seedOpenWater(this.seaLevel, this.terrainField);
  }

  /** Flatten a foundation pad + walkable doorway apron under each building. */
  private carveBuildingPads(field: TerrainField, coreLevel: number): void {
    const flatten = (x0: number, z0: number, x1: number, z1: number, walk: boolean): void => {
      const ix0 = Math.max(0, Math.floor(x0));
      const ix1 = Math.min(field.w - 1, Math.ceil(x1));
      const iz0 = Math.max(0, Math.floor(z0));
      const iz1 = Math.min(field.d - 1, Math.ceil(z1));
      for (let z = iz0; z <= iz1; z++)
        for (let x = ix0; x <= ix1; x++) {
          const i = z * field.w + x;
          field.height[i] = coreLevel;
          field.material[i] = 4; // Stone foundation
          if (walk) field.walkable[i] = 1;
        }
    };
    for (const s of this.townSpecs()) {
      const hw = s.w / 2 + 1;
      const hd = s.d / 2 + 1;
      flatten(s.x - hw, s.z - hd, s.x + hw, s.z + hd, true);
      // walkable apron in front of the door, between building and street
      const apron = 14;
      if (s.facing === 0) flatten(s.doorX - 8, s.z + hd, s.doorX + 8, s.z + hd + apron, true);
      else flatten(s.doorX - 8, s.z - hd - apron, s.doorX + 8, s.z - hd, true);
    }
  }

  /**
   * Sculpt a river valley: a spring mound in the SE hills feeding a channel
   * that drops over a waterfall and runs west into the SW lake. Carves the
   * heightfield (deep channel + raised banks), tags the bed, blocks the deep
   * water, and records the surface polyline for {@link WaterFeatures}.
   */
  private carveRiver(field: TerrainField): void {
    const cxs = [440, 410, 385, 370, 366, 330, 285, 238, 195, 163];
    const czs = [434, 432, 430, 429, 428, 426, 422, 417, 413, 410];
    const beds = [17, 15, 14, 13, 3, 2.6, 2.2, 1.8, 1.4, 1.0];
    const halfs = [3, 3, 3, 3, 4, 4, 5, 5, 6, 7];
    const n = cxs.length;

    this.riverPath = cxs.map((x, i) => ({ x, z: czs[i]!, y: beds[i]! + 0.8, half: halfs[i]! }));

    const setBed = (x: number, z: number, bedY: number, half: number): void => {
      const bank = 4;
      const R = Math.ceil(half + bank);
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const ix = Math.round(x + dx);
          const iz = Math.round(z + dz);
          if (ix < 0 || iz < 0 || ix >= field.w || iz >= field.d) continue;
          const i = iz * field.w + ix;
          const dist = Math.hypot(dx, dz);
          if (dist <= half) {
            field.height[i] = Math.round(bedY - 1); // sunken channel floor
            field.material[i] = TerrainMaterial.Stone; // wet riverbed
            field.walkable[i] = 1; // wadeable stream
          } else if (dist <= half + bank) {
            const target = Math.round(bedY + 2);
            if (field.height[i]! < target) {
              field.height[i] = target; // raise containing banks
              field.material[i] = TerrainMaterial.Rock;
            }
          }
        }
      }
    };

    // spring mound so the source clearly sits up on high ground
    const speak = beds[0]! + 5;
    const mR = 22;
    for (let dz = -mR; dz <= mR; dz++) {
      for (let dx = -mR; dx <= mR; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > mR) continue;
        const ix = Math.round(cxs[0]! + dx);
        const iz = Math.round(czs[0]! + dz);
        if (ix < 0 || iz < 0 || ix >= field.w || iz >= field.d) continue;
        const i = iz * field.w + ix;
        const h = Math.round(speak * (1 - d / mR));
        if (field.height[i]! < h) {
          field.height[i] = h;
          field.material[i] = TerrainMaterial.Rock;
        }
      }
    }

    // rasterise the channel along each segment
    for (let s = 0; s < n - 1; s++) {
      const ax = cxs[s]!, az = czs[s]!, ab = beds[s]!, ah = halfs[s]!;
      const bx = cxs[s + 1]!, bz = czs[s + 1]!, bb = beds[s + 1]!, bh = halfs[s + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len * 2));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        setBed(ax + (bx - ax) * t, az + (bz - az) * t, ab + (bb - ab) * t, ah + (bh - ah) * t);
      }
    }
  }

  /** Stamp a sunken paved road segment (with curb step) into the field. */
  private carveStreets(field: TerrainField, coreLevel: number): void {
    const roadY = coreLevel - 1;
    const stamp = (x: number, z: number, half: number): void => {
      const x0 = Math.max(0, Math.floor(x - half));
      const x1 = Math.min(field.w - 1, Math.ceil(x + half));
      const z0 = Math.max(0, Math.floor(z - half));
      const z1 = Math.min(field.d - 1, Math.ceil(z + half));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const i = cz * field.w + cx;
          // only pave the flat town core, never the hills/water
          if (field.height[i]! < coreLevel - 1 || field.height[i]! > coreLevel + 1) continue;
          field.height[i] = roadY;
          field.material[i] = 5; // Path
          field.walkable[i] = 1;
        }
      }
    };
    const road = (x0: number, z0: number, x1: number, z1: number, half: number): void => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        stamp(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, half);
      }
    };

    const CX = this.cx;
    const CZ = this.cz;
    // two avenues in front of the house rows + a central cross street
    road(110, 200, 402, 200, 3);
    road(110, 332, 402, 332, 3);
    road(CX, 130, CX, 392, 3);
    road(130, 200, 130, 332, 2.5);
    road(300, 200, 300, 332, 2.5);
    // plaza ring connector
    road(CX, 392, CX, 470, 2.5);
  }

  /** Stack props vertically (e.g. crate on a dumpster), each sitting on the one below. */
  private placeStack(stack: Array<{ modelId: string; facing?: number; dx?: number; dz?: number }>, x: number, z: number): void {
    let y = 0;
    let baseHalf = 4;
    for (let i = 0; i < stack.length; i++) {
      const s = stack[i]!;
      const model = this.engine.animation.getModel(s.modelId);
      if (!model) continue;
      this.placeProp(s.modelId, x + (s.dx ?? 0), z + (s.dz ?? 0), s.facing ?? 0, false, y);
      if (i === 0) baseHalf = Math.max(model.bounds[0], model.bounds[2]) / 2 - 1;
      y += model.bounds[1] - 0.5; // next item rests on top
    }
    this.solids.push({ x0: x - baseHalf, z0: z - baseHalf, x1: x + baseHalf, z1: z + baseHalf });
  }

  private addBuilding(spec: BuildingSpec): void {
    this.ensureBuildingModel(spec);
    this.placeProp(spec.id, spec.x, spec.z, spec.facing);
    // footprint collision (leave the doorway clear so the player can step in)
    const hw = spec.w / 2 - 1;
    const hd = spec.d / 2 - 1;
    this.solids.push({ x0: spec.x - hw, z0: spec.z - hd, x1: spec.x + hw, z1: spec.z + hd });
    // door trigger just outside the doorway; must be facing into the building
    const lm = INTERIOR_BY_ID.get(spec.interiorMap);
    const spawn = lm ? { x: lm.w / 2, z: lm.d - 18 } : interiorSpawn(spec);
    this.doors.push({
      x: spec.doorX,
      z: spec.doorZ,
      r: 14,
      toMap: spec.interiorMap,
      toX: spawn.x,
      toZ: spawn.z,
      enterFacing: spec.enterFacing,
    });
  }

  private isOpen(x: number, z: number, pad: number): boolean {
    if (this.collides(x, z, pad, pad)) return false;
    if (Math.abs(x - this.cx) < 80 && Math.abs(z - this.cz) < 80) return false;
    if (Math.abs(x - this.cx) < 20 || Math.abs(z - this.cz) < 20) return false;
    return true;
  }

  private scatterNature(): void {
    const rng = new Rng(hashSeed(this.engine.gs.data.worldSeed, 0x5ca77e));
    const allTreeIds = [...treeModelIds, ...pineModelIds];
    const weighted: string[] = [];
    for (const id of allTreeIds) {
      const w = id.includes('giant') ? 1 : id.includes('large') || id.includes('tall') ? 2 : id.includes('sapling') ? 2 : 3;
      for (let i = 0; i < w; i++) weighted.push(id);
    }
    const flowerIds = ['flower_red', 'flower_yellow', 'flower_purple', 'flower_white'];

    let placed = 0;
    let attempts = 0;
    while (placed < 52 && attempts < 1400) {
      attempts++;
      const x = 24 + rng.next() * (this.mapW - 48);
      const z = 24 + rng.next() * (this.mapD - 48);
      // keep the eastern meadow lightly treed (it's the battle zone)
      if (x > 360 && z > 200 && z < 360 && rng.chance(0.7)) continue;
      const edgeBias = Math.min(x, this.mapW - x, z, this.mapD - z);
      if (edgeBias > 150 && rng.chance(0.6)) continue;
      if (!this.isOpen(x, z, 14)) continue;
      const id = rng.pick(weighted);
      this.placeProp(id, x, z, 0, true);
      const r = id.includes('giant') ? 6 : id.includes('large') || id.includes('tall') ? 5 : 3;
      this.solids.push({ x0: x - r, z0: z - r, x1: x + r, z1: z + r });
      placed++;
    }
    for (let i = 0; i < 40; i++) {
      const x = 24 + rng.next() * (this.mapW - 48);
      const z = 24 + rng.next() * (this.mapD - 48);
      if (!this.isOpen(x, z, 5)) continue;
      this.placeProp(rng.chance(0.65) ? 'bush' : 'rock', x, z);
    }
    // flowers dotted around town
    for (let i = 0; i < 70; i++) {
      const x = 16 + rng.next() * (this.mapW - 32);
      const z = 16 + rng.next() * (this.mapD - 32);
      if (Math.abs(x - this.cx) < 56 && Math.abs(z - this.cz) < 56) continue;
      if (this.terrainField && !walkableAt(this.terrainField, x, z)) continue;
      this.placeProp(rng.pick(flowerIds), x, z);
    }
  }

  // -- interiors ------------------------------------------------------------

  private resolveInterior(mapId: string): InteriorMap | undefined {
    const landmark = INTERIOR_BY_ID.get(mapId);
    if (landmark) return landmark;
    const spec = this.townSpecs().find((s) => s.interiorMap === mapId);
    if (spec) return generateInterior(this.engine.gs.data.worldSeed, spec);
    return undefined;
  }

  private buildInterior(mapId: string): void {
    const map = this.resolveInterior(mapId);
    if (!map) {
      this.buildTown();
      return;
    }
    this.mapW = map.w;
    this.mapD = map.d;
    this.cx = map.w / 2;
    this.cz = map.d / 2;

    // floor + walls
    this.slab(this.cx, this.cz, map.w, map.d, 0, 4, map.floorColor);
    const wt = 6;
    this.slab(this.cx, wt / 2, map.w, wt, 30, 30, map.wallColor); // back wall (north, z small)
    this.slab(wt / 2, this.cz, wt, map.d, 30, 30, map.wallColor); // west
    this.slab(map.w - wt / 2, this.cz, wt, map.d, 30, 30, map.wallColor); // east
    this.solids.push({ x0: 0, z0: 0, x1: map.w, z1: wt + 2 });
    this.solids.push({ x0: 0, z0: 0, x1: wt + 2, z1: map.d });
    this.solids.push({ x0: map.w - wt - 2, z0: 0, x1: map.w, z1: map.d });

    // exit doormat(s)
    for (const d of map.doors) {
      this.slab(d.x, d.z, 18, 8, 0.05, 0.4, 0x4a3a2a);
      this.doors.push({ x: d.x, z: d.z, r: 8, toMap: d.toMap, toX: d.toX, toZ: d.toZ });
    }

    // furniture: procedural props if provided, else two flavor boxes
    if (map.props && map.props.length) {
      for (const p of map.props) {
        const created = this.placeProp(p.modelId, p.x, p.z, p.facing ?? 0);
        if (!created) continue;
        const model = this.engine.animation.getModel(p.modelId);
        const half = model ? Math.max(model.bounds[0], model.bounds[2]) / 2 - 1 : 4;
        this.solids.push({ x0: p.x - half, z0: p.z - half, x1: p.x + half, z1: p.z + half });
      }
    } else {
      this.slab(20, 24, 16, 12, 10, 10, 0x8a6a3a);
      this.slab(map.w - 24, 24, 14, 10, 9, 9, 0x6a4a8a);
      this.solids.push({ x0: 12, z0: 18, x1: 28, z1: 30 });
      this.solids.push({ x0: map.w - 31, z0: 19, x1: map.w - 17, z1: 29 });
    }

    // NPCs
    for (const n of map.npcs) {
      this.addNpc(n.modelId, n.x, n.z, n.facing, n.dialogue, !!n.wander);
    }
    for (const s of map.signs ?? []) this.addSign(s.x, s.z, s.dialogue);

    this.applyCustomPlacements(mapId);
  }

  // -- actors ---------------------------------------------------------------

  private makeBrain(mode: 'wander' | 'route', x: number, z: number): NpcBrain {
    return {
      mode,
      homeX: x,
      homeZ: z,
      radius: 40,
      speed: 0.06,
      path: null,
      pathIdx: 0,
      stuck: 0,
      waitTimer: Math.floor(Math.random() * 40),
      repathCooldown: 0,
      routeIdx: 0,
      routeDir: 1,
      routeLoop: 'loop',
      routePause: 0,
    };
  }

  private registeredChars = new Set<string>();

  /** Generate (once) a seeded, diverse townsperson model. Returns id + scale. */
  private genTownsfolk(tag: string, forced?: SizeClass): { modelId: string; scale: number } {
    const id = `npc_${tag}`;
    const seed = hashSeed(this.engine.gs.data.worldSeed, hashSeed(...[...tag].map((c) => c.charCodeAt(0))));
    const gen = generateCharacter(id, seed, forced);
    if (!this.registeredChars.has(id)) {
      this.engine.animation.registerModel(gen.model);
      this.registeredChars.add(id);
    }
    return { modelId: id, scale: gen.scale };
  }

  /** Add an ambient wanderer with a generated look. */
  private addTownsfolk(tag: string, x: number, z: number, facing: number, dialogue: string, forced?: SizeClass): void {
    const { modelId, scale } = this.genTownsfolk(tag, forced);
    this.addNpc(modelId, x, z, facing, dialogue, true, scale);
  }

  private addNpc(modelId: string, x: number, z: number, facing: number, dialogue?: string, wander = false, scale = 1): void {
    const actor = this.makeActor({ modelId, archetype: 'villager', x, z, facing: facing as 0 | 1 | 2 | 3, isPlayer: false, scale });
    actor.dialogue = dialogue;
    actor.homeFacing = facing as 0 | 1 | 2 | 3;
    if (wander) actor.ai = this.makeBrain('wander', x, z);
    if (dialogue) this.interactables.push({ x, z, r: 18, dialogue, actor });
  }

  private addRoutedNpc(
    modelId: string,
    dialogue: string,
    route: NavPoint[],
    loop: 'loop' | 'pingpong' | 'once',
    pause: number,
    scale = 1,
  ): void {
    const start = route[0]!;
    const actor = this.makeActor({ modelId, archetype: 'villager', x: start.x, z: start.z, facing: 2, isPlayer: false, scale });
    actor.dialogue = dialogue;
    const brain = this.makeBrain('route', start.x, start.z);
    brain.route = route;
    brain.routeLoop = loop;
    brain.routePause = pause;
    actor.ai = brain;
    this.interactables.push({ x: start.x, z: start.z, r: 18, dialogue, actor });
  }

  private addSign(x: number, z: number, dialogue: string): void {
    this.interactables.push({ x, z, r: 16, dialogue });
  }

  private addSpecial(x: number, z: number, dialogue: string): void {
    this.interactables.push({ x, z, r: 18, dialogue });
  }

  private _shadowGeo: THREE.CircleGeometry | null = null;
  private _shadowMat: THREE.MeshBasicMaterial | null = null;
  private shadowGeo(): THREE.CircleGeometry {
    return (this._shadowGeo ??= new THREE.CircleGeometry(6, 16));
  }
  private shadowMat(): THREE.MeshBasicMaterial {
    return (this._shadowMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  }

  private makeActor(opts: { modelId: string; archetype: string; x: number; z: number; facing: 0 | 1 | 2 | 3; isPlayer: boolean; scale?: number }): Actor {
    const { world, animation } = this.engine;
    const id = world.createEntity();
    world.stores.transform.set(id, { x: opts.x, y: 0, z: opts.z, facing: opts.facing });
    world.stores.movement.set(id, { speed: opts.isPlayer ? 0.45 : 0.05, runMultiplier: opts.isPlayer ? 2.1 : 1.9, vx: 0, vz: 0, moving: false });
    world.stores.animation.set(id, { currentState: 'idle', clipName: 'idle', frameIndex: 0, animStepSeen: -1, randomIdleTimer: 0 });
    world.stores.voxelModel.set(id, { modelId: opts.modelId });

    const model = animation.getModel(opts.modelId)!;
    const mesh = new VoxelMesh(this.engine.settings.render.voxelBevel);
    mesh.buildFromModelFrame(model, 'idle_0');
    const [pvx, , pvz] = model.pivot;
    mesh.group.position.set(-pvx, 0, -pvz);
    const container = new THREE.Group();
    container.position.set(opts.x, this.groundHeight(opts.x, opts.z), opts.z);
    container.rotation.y = (opts.facing * Math.PI) / 2;
    const scale = opts.scale ?? 1;
    if (scale !== 1) container.scale.setScalar(scale);
    // soft blob shadow grounding the character
    const shadow = new THREE.Mesh(this.shadowGeo(), this.shadowMat());
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.3, 1);
    shadow.scale.setScalar(Math.max(model.bounds[0], model.bounds[2]) / 14);
    container.add(shadow);
    container.add(mesh.group);
    this.engine.threeScene.add(container);

    const actor: Actor = { id, container, modelId: opts.modelId, archetype: opts.archetype, mesh, hw: 5 * scale, hd: 5 * scale, isPlayer: opts.isPlayer };
    this.actors.push(actor);
    return actor;
  }

  private spawnPlayer(x: number, z: number): void {
    this.player = this.makeActor({ modelId: this.engine.gs.leader().modelId, archetype: 'villager', x, z, facing: 0, isPlayer: true });
  }
}
