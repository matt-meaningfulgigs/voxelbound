import * as THREE from 'three';
import {
  heightAt,
  hashSeed,
  type SurfaceCover,
  type TerrainField,
  tIdx,
} from '@voxelbound/shared';

/**
 * Windowed grass-blade layer. Renders short voxel blades on grassy columns
 * within a radius of the player using a single InstancedMesh. Blades stand up
 * normally and tip over (in the laid direction) where the SurfaceCover bitmap
 * says they've been trampled. Rebuilds only when the player crosses into a new
 * cell or the cover changes, so it's cheap.
 */
export class GrassLayer {
  readonly mesh: THREE.InstancedMesh;
  private field: TerrainField;
  private cover: SurfaceCover;
  private radius: number;
  private capacity: number;
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private dummy = new THREE.Object3D();
  private colorStanding = new THREE.Color(0x6bb33f);
  private colorTrampled = new THREE.Color(0x8aa84a);

  constructor(scene: THREE.Scene, field: TerrainField, cover: SurfaceCover, radius = 34) {
    this.field = field;
    this.cover = cover;
    this.radius = radius;
    const span = radius * 2 + 1;
    this.capacity = span * span;

    const geo = new THREE.BoxGeometry(0.32, 1.25, 0.32);
    geo.translate(0, 0.625, 0); // pivot at the base so tipping rotates from the ground
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(px: number, pz: number): void {
    const cx = Math.round(px);
    const cz = Math.round(pz);
    if (cx === this.lastCx && cz === this.lastCz && !this.cover.dirty) return;
    this.lastCx = cx;
    this.lastCz = cz;
    this.cover.dirty = false;

    const { field, radius } = this;
    let n = 0;
    const cap = this.capacity;
    const x0 = Math.max(0, cx - radius);
    const x1 = Math.min(field.w - 1, cx + radius);
    const z0 = Math.max(0, cz - radius);
    const z1 = Math.min(field.d - 1, cz + radius);

    for (let z = z0; z <= z1 && n < cap; z++) {
      for (let x = x0; x <= x1 && n < cap; x++) {
        const i = tIdx(x, z, field.w);
        if (!this.cover.eligible[i]) continue;

        // deterministic per-cell jitter so blades don't form a rigid grid
        const h = hashSeed(x, z, 0x9e37);
        const jx = ((h & 0xff) / 255 - 0.5) * 0.7;
        const jz = (((h >> 8) & 0xff) / 255 - 0.5) * 0.7;
        const sh = 0.7 + ((h >> 16) & 0xff) / 255 * 0.7; // blade height variance

        const wx = x + 0.5 + jx;
        const wz = z + 0.5 + jz;
        const y = heightAt(field, x, z);

        const d = this.dummy;
        d.position.set(wx, y, wz);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, sh, 1);

        const st = this.cover.state[i]!;
        if (st !== 0) {
          // laid down toward facing (1=N,2=E,3=S,4=W)
          const facing = st - 1;
          const tip = Math.PI * 0.42;
          if (facing === 0) d.rotation.x = -tip;
          else if (facing === 2) d.rotation.x = tip;
          else if (facing === 1) d.rotation.z = -tip;
          else d.rotation.z = tip;
        }
        d.updateMatrix();
        this.mesh.setMatrixAt(n, d.matrix);
        this.mesh.setColorAt(n, st !== 0 ? this.colorTrampled : this.colorStanding);
        n++;
      }
    }

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
