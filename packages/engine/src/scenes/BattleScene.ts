import * as THREE from 'three';
import type { GameEngine } from '../GameEngine';
import type { Scene } from '../core/SceneManager';
import { VoxelMesh } from '../render/VoxelRenderer';

interface EnemySprite {
  container: THREE.Group;
  mesh: VoxelMesh;
  modelId: string;
  baseX: number;
  alive: boolean;
  shakeT: number;
}

/**
 * EarthBound-style first-person battle view: enemies + a scrolling psychedelic
 * backdrop. The party is shown only as DOM HP/PP windows (handled by the UI).
 */
export class BattleScene implements Scene {
  readonly id = 'battle' as const;
  private engine: GameEngine;
  private sprites: EnemySprite[] = [];
  private bands: THREE.Mesh[] = [];
  private animUnsub: (() => void) | null = null;
  private savedBg: THREE.Color | THREE.Texture | null = null;
  private flashOverlay: THREE.Mesh | null = null;
  private flashT = 0;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  enter(): void {
    const scene = this.engine.threeScene;
    this.savedBg = scene.background as THREE.Color | null;
    scene.background = new THREE.Color(0x05030a);
    scene.fog = null;

    this.buildBackdrop();
    this.buildEnemies();
    this.frameCamera();

    this.animUnsub = this.engine.bus.on<number>('animStep', (s) => this.onAnimStep(s));
  }

  exit(): void {
    this.animUnsub?.();
    this.sprites.forEach((s) => {
      s.mesh.dispose();
      this.engine.threeScene.remove(s.container);
    });
    this.bands.forEach((b) => {
      b.geometry.dispose();
      (b.material as THREE.Material).dispose();
      this.engine.threeScene.remove(b);
    });
    if (this.flashOverlay) {
      this.engine.threeScene.remove(this.flashOverlay);
      this.flashOverlay.geometry.dispose();
      (this.flashOverlay.material as THREE.Material).dispose();
      this.flashOverlay = null;
    }
    this.sprites = [];
    this.bands = [];
    if (this.savedBg) this.engine.threeScene.background = this.savedBg;
  }

  updateWorldTick(): void {
    for (const s of this.sprites) {
      if (s.shakeT > 0) {
        s.shakeT -= 1;
        s.container.position.x = s.baseX + (Math.random() - 0.5) * 4;
        if (s.shakeT === 0) s.container.position.x = s.baseX;
      }
    }
    if (this.flashT > 0 && this.flashOverlay) {
      this.flashT -= 1;
      (this.flashOverlay.material as THREE.MeshBasicMaterial).opacity = this.flashT / 6;
      if (this.flashT === 0) this.flashOverlay.visible = false;
    }
  }

  updateRender(): void {}

  // -- public hooks for the battle UI --------------------------------------

  hitEnemy(index: number): void {
    const s = this.sprites[index];
    if (s) s.shakeT = 6;
    this.flash(0xffffff, 0.5);
  }

  smaaash(): void {
    this.flash(0xffe040, 0.85);
    this.sprites.forEach((s) => (s.shakeT = 8));
  }

  killEnemy(index: number): void {
    const s = this.sprites[index];
    if (s && s.alive) {
      s.alive = false;
      s.container.visible = false;
    }
  }

  flashScreen(color = 0xff4040): void {
    this.flash(color, 0.6);
  }

  private flash(color: number, strength: number): void {
    if (!this.flashOverlay) return;
    const mat = this.flashOverlay.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = strength;
    this.flashOverlay.visible = true;
    this.flashT = 6;
  }

  // -- build ----------------------------------------------------------------

  private buildBackdrop(): void {
    const colors = [0x3a1060, 0x10406a, 0x6a1050, 0x104a3a, 0x503a10, 0x301060];
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.BoxGeometry(600, 22, 2);
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length] });
      const band = new THREE.Mesh(geo, mat);
      band.position.set(0, 5 + i * 18, -120);
      this.engine.threeScene.add(band);
      this.bands.push(band);
    }
    const fgeo = new THREE.PlaneGeometry(4000, 4000);
    const fmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });
    this.flashOverlay = new THREE.Mesh(fgeo, fmat);
    this.flashOverlay.visible = false;
    this.flashOverlay.renderOrder = 999;
    this.engine.threeScene.add(this.flashOverlay);
  }

  private buildEnemies(): void {
    const enemies = this.engine.battle.enemies;
    const n = enemies.length;
    const spacing = n > 1 ? Math.min(46, 150 / n) : 0;
    enemies.forEach((e, i) => {
      const model = this.engine.animation.getModel(e.modelId);
      if (!model) return;
      const [pvx, , pvz] = model.pivot;
      const mesh = new VoxelMesh(this.engine.settings.render.voxelBevel);
      mesh.buildFromModelFrame(model, 'idle_0');
      mesh.group.position.set(-pvx, 0, -pvz);
      const container = new THREE.Group();
      const x = (i - (n - 1) / 2) * spacing;
      const depth = e.isBoss ? -10 : (i % 2 === 0 ? 0 : 10);
      container.position.set(x, 0, depth);
      container.add(mesh.group);
      this.engine.threeScene.add(container);
      this.sprites.push({ container, mesh, modelId: e.modelId, baseX: x, alive: true, shakeT: 0 });
    });
  }

  private frameCamera(): void {
    const cam = this.engine.camera.camera;
    const enemies = this.engine.battle.enemies;
    const tallest = Math.max(20, ...enemies.map((e) => this.modelHeight(e.modelId)));
    const midY = tallest * 0.5;
    const frameH = Math.max(70, tallest * 2.2);
    const aspect = this.engine.aspect();
    if (cam instanceof THREE.OrthographicCamera) {
      cam.left = (-frameH * aspect) / 2;
      cam.right = (frameH * aspect) / 2;
      cam.top = frameH / 2;
      cam.bottom = -frameH / 2;
      cam.near = 0.1;
      cam.far = 2000;
      cam.updateProjectionMatrix();
    } else if (cam instanceof THREE.PerspectiveCamera) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    cam.position.set(0, midY + 28, 150);
    cam.lookAt(0, midY, 0);
  }

  private modelHeight(modelId: string): number {
    const m = this.engine.animation.getModel(modelId);
    return m ? m.bounds[1] : 24;
  }

  private onAnimStep(step: number): void {
    for (const s of this.sprites) {
      if (!s.alive) continue;
      const model = this.engine.animation.getModel(s.modelId);
      if (model) s.mesh.buildFromModelFrame(model, step % 2 === 0 ? 'idle_0' : 'idle_1');
    }
    this.bands.forEach((b, i) => {
      b.position.x = ((step * (4 + i)) % 80) - 40;
    });
  }
}
