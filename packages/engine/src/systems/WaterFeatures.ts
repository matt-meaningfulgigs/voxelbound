import * as THREE from 'three';

/**
 * Voxel water dynamics: a single instanced pool of little water cubes used for
 * the fountain spray, waterfall droplets and footstep splashes, plus drifting
 * "foam" voxels that ride a river's arc-length path so the current is visible,
 * and a translucent surface ribbon for the river/waterfall body.
 *
 * Everything is driven per render-frame from {@link update} so motion is smooth
 * (independent of the coarse world-tick clock used by gameplay).
 */

export interface RiverPoint {
  x: number;
  z: number;
  /** Water-surface height at this point. */
  y: number;
  /** Channel half-width in world units. */
  half: number;
}

type Mode = 0 | 1; // 0 = free (gravity), 1 = foam (rides the path)

interface Particle {
  active: boolean;
  mode: Mode;
  x: number;
  y: number;
  z: number;
  // free
  vx: number;
  vy: number;
  vz: number;
  floorY: number;
  // foam
  s: number;
  lateral: number;
  speed: number;
  // shared
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

const GRAV = 46; // world units / s^2

export class WaterFeatures {
  private scene: THREE.Scene;
  private mesh: THREE.InstancedMesh;
  private cap: number;
  private parts: Particle[] = [];
  private next = 0;
  private dummy = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();
  private elapsed = 0;

  // fountains: spout emitters
  private fountains: Array<{ x: number; y: number; z: number; basinY: number; acc: number }> = [];

  // river path (arc-length parameterised)
  private river: {
    pts: RiverPoint[];
    cum: number[];
    total: number;
    drops: Array<{ x: number; y: number; z: number; baseY: number; half: number }>;
    foamAcc: number;
    dropAcc: number;
  } | null = null;
  private ribbons: THREE.Mesh[] = [];

  // throttle for footstep splashes
  private splashAcc = 0;

  constructor(scene: THREE.Scene, capacity = 640) {
    this.scene = scene;
    this.cap = capacity;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.92 });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor = colorAttr;
    for (let i = 0; i < capacity; i++) {
      this.parts.push({
        active: false, mode: 0, x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0, floorY: 0,
        s: 0, lateral: 0, speed: 0,
        life: 0, maxLife: 1, size: 1, r: 0.6, g: 0.8, b: 1,
      });
      this.hide(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.mesh);
  }

  // -- public configuration -------------------------------------------------

  /** Register a fountain spout that continuously launches voxels upward. */
  addFountainAt(x: number, z: number, spoutY: number, basinY: number): void {
    this.fountains.push({ x, y: spoutY, z, basinY, acc: 0 });
  }

  /**
   * Define the river. Points are ordered upstream→downstream; steep drops
   * between consecutive points become waterfalls (extra falling droplets +
   * splash at the base). Also builds the translucent surface ribbon.
   */
  setRiver(pts: RiverPoint[]): void {
    if (pts.length < 2) return;
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const total = cum[cum.length - 1]!;
    const drops: Array<{ x: number; y: number; z: number; baseY: number; half: number }> = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const horiz = Math.hypot(b.x - a.x, b.z - a.z);
      const fall = a.y - b.y;
      if (fall > 4 && fall > horiz * 0.6) {
        // a near-vertical drop: waterfall from a's lip to b's pool
        drops.push({ x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2, baseY: b.y, half: Math.min(a.half, b.half) });
      }
    }
    this.river = { pts, cum, total, drops, foamAcc: 0, dropAcc: 0 };
    this.buildRibbon(pts);
  }

  // -- emission --------------------------------------------------------------

  /** Burst of splash droplets, e.g. when an actor wades through water. */
  splash(x: number, y: number, z: number, n = 6, power = 8): void {
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = power * (0.4 + Math.random() * 0.8);
      this.emitFree(
        x + (Math.random() - 0.5), y + 0.5, z + (Math.random() - 0.5),
        Math.cos(ang) * sp * 0.5, power * (0.7 + Math.random() * 0.7), Math.sin(ang) * sp * 0.5,
        y, 0.6 + Math.random() * 0.5, 0.55 + Math.random() * 0.12, 0.74 + Math.random() * 0.12, 0.95,
      );
    }
  }

  /** Throttled splash so a walking actor leaves a steady spray, not a storm. */
  wade(x: number, y: number, z: number, dt: number): void {
    this.splashAcc += dt;
    if (this.splashAcc < 0.12) return;
    this.splashAcc = 0;
    this.splash(x, y, z, 4, 7);
  }

  // -- per-frame -------------------------------------------------------------

  update(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;

    // fountain emission
    for (const f of this.fountains) {
      f.acc += dt;
      const rate = 0.012; // seconds between voxels
      while (f.acc >= rate) {
        f.acc -= rate;
        const ang = Math.random() * Math.PI * 2;
        const out = Math.random() * 3.2;
        this.emitFree(
          f.x + Math.cos(ang) * 0.6, f.y, f.z + Math.sin(ang) * 0.6,
          Math.cos(ang) * out, 24 + Math.random() * 9, Math.sin(ang) * out,
          f.basinY, 0.7 + Math.random() * 0.6,
          0.55 + Math.random() * 0.1, 0.78 + Math.random() * 0.12, 0.98,
        );
      }
    }

    // river foam + waterfall droplets
    const r = this.river;
    if (r) {
      r.foamAcc += dt;
      const foamRate = 0.03;
      while (r.foamAcc >= foamRate) {
        r.foamAcc -= foamRate;
        this.emitFoam();
      }
      r.dropAcc += dt;
      const dropRate = 0.02;
      while (r.dropAcc >= dropRate) {
        r.dropAcc -= dropRate;
        for (const d of r.drops) {
          const lx = d.x + (Math.random() - 0.5) * d.half * 1.4;
          const lz = d.z + (Math.random() - 0.5) * d.half * 1.4;
          this.emitFree(
            lx, d.y - Math.random() * 2, lz,
            (Math.random() - 0.5) * 2, -2 - Math.random() * 4, (Math.random() - 0.5) * 2,
            d.baseY, 0.7 + Math.random() * 0.7,
            0.62, 0.82, 0.98,
          );
        }
      }
    }

    // integrate
    for (let i = 0; i < this.cap; i++) {
      const p = this.parts[i]!;
      if (!p.active) continue;
      p.life += dt;
      if (p.mode === 0) {
        p.vy -= GRAV * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y <= p.floorY) {
          if (p.life > p.maxLife * 0.4 && p.size > 0.55 && Math.random() < 0.25) {
            // little secondary splash ring when a fat droplet lands
            this.emitFree(p.x, p.floorY + 0.2, p.z, p.vx * 0.2, 3 + Math.random() * 3, p.vz * 0.2, p.floorY, 0.45, 0.7, 0.85, 0.98);
          }
          this.hideAndKill(i);
          continue;
        }
      } else {
        // foam riding the river
        p.s += p.speed * dt;
        const samp = this.sampleRiver(p.s);
        if (!samp) { this.hideAndKill(i); continue; }
        p.x = samp.x + samp.nx * p.lateral;
        p.z = samp.z + samp.nz * p.lateral;
        p.y = samp.y + 0.35 + Math.sin((this.elapsed + p.s) * 6) * 0.15;
        // speed up on the steeps
        p.speed = samp.steep ? 34 : 13;
      }
      if (p.life >= p.maxLife) { this.hideAndKill(i); continue; }
      this.write(i, p);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.ribbons.forEach((m) => {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.ribbons = [];
    this.fountains = [];
    this.river = null;
  }

  // -- internals -------------------------------------------------------------

  private emitFree(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    floorY: number, size: number, r: number, g: number, b: number,
  ): void {
    const i = this.alloc();
    const p = this.parts[i]!;
    p.active = true; p.mode = 0;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz; p.floorY = floorY;
    p.life = 0; p.maxLife = 2.2; p.size = size;
    p.r = r; p.g = g; p.b = b;
    this.write(i, p);
  }

  private emitFoam(): void {
    const r = this.river!;
    const i = this.alloc();
    const p = this.parts[i]!;
    const samp = this.sampleRiver(0)!;
    p.active = true; p.mode = 1;
    p.s = Math.random() * 4;
    p.lateral = (Math.random() - 0.5) * samp.half * 1.5;
    p.speed = 13;
    p.x = samp.x; p.y = samp.y + 0.35; p.z = samp.z;
    p.life = 0; p.maxLife = (r.total / 12) + 2; p.size = 0.7 + Math.random() * 0.6;
    p.r = 0.78; p.g = 0.9; p.b = 1.0;
    this.write(i, p);
  }

  private alloc(): number {
    for (let k = 0; k < this.cap; k++) {
      const i = (this.next + k) % this.cap;
      if (!this.parts[i]!.active) { this.next = (i + 1) % this.cap; return i; }
    }
    const i = this.next; this.next = (i + 1) % this.cap; return i; // overwrite oldest-ish
  }

  private hideAndKill(i: number): void {
    this.parts[i]!.active = false;
    this.hide(i);
  }

  private hide(i: number): void {
    this.sc.set(0, 0, 0);
    this.v.set(0, -9999, 0);
    this.dummy.compose(this.v, this.q, this.sc);
    this.mesh.setMatrixAt(i, this.dummy);
  }

  private write(i: number, p: Particle): void {
    this.v.set(p.x, p.y, p.z);
    this.sc.set(p.size, p.size, p.size);
    this.dummy.compose(this.v, this.q, this.sc);
    this.mesh.setMatrixAt(i, this.dummy);
    this.col.setRGB(p.r, p.g, p.b);
    this.mesh.setColorAt(i, this.col);
  }

  /** Sample river position + unit normal (XZ) + steepness at arc length s. */
  private sampleRiver(s: number): { x: number; y: number; z: number; nx: number; nz: number; half: number; steep: boolean } | null {
    const r = this.river;
    if (!r) return null;
    if (s >= r.total) return null;
    if (s < 0) s = 0;
    let i = 1;
    while (i < r.cum.length && r.cum[i]! < s) i++;
    const a = r.pts[i - 1]!;
    const b = r.pts[i]!;
    const seg = r.cum[i]! - r.cum[i - 1]! || 1;
    const t = (s - r.cum[i - 1]!) / seg;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const half = a.half + (b.half - a.half) * t;
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const steep = a.y - b.y > 4 && a.y - b.y > Math.hypot(b.x - a.x, b.z - a.z) * 0.6;
    return { x, y, z, nx: -dz, nz: dx, half, steep };
  }

  /** Translucent water-surface ribbon following the river (vertical at falls). */
  private buildRibbon(pts: RiverPoint[]): void {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = pts[Math.max(0, i - 1)]!;
      const nx0 = pts[Math.min(pts.length - 1, i + 1)]!.x - prev.x;
      const nz0 = pts[Math.min(pts.length - 1, i + 1)]!.z - prev.z;
      const dl = Math.hypot(nx0, nz0) || 1;
      const nx = -nz0 / dl;
      const nz = nx0 / dl;
      positions.push(p.x + nx * p.half, p.y, p.z + nz * p.half);
      positions.push(p.x - nx * p.half, p.y, p.z - nz * p.half);
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      color: 0x3f8fd0, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this.ribbons.push(mesh);
  }
}
