import * as THREE from 'three';
import type { VoxelModel } from '@voxelbound/shared';
import { voxelsFromFrame } from '@voxelbound/shared';

const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();
const _dummy = new THREE.Object3D();

export class VoxelMesh {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BoxGeometry;
  private material: THREE.MeshLambertMaterial;

  constructor(bevel = 0.05) {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    if (bevel > 0) {
      // slight scale for softer look
    }
    this.material = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.group.add(new THREE.Group()); // placeholder
  }

  buildFromVoxels(
    voxels: Array<{ x: number; y: number; z: number; color: number }>,
  ): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    if (voxels.length === 0) return;

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, voxels.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    voxels.forEach((v, i) => {
      _dummy.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5);
      _dummy.updateMatrix();
      this.mesh!.setMatrixAt(i, _dummy.matrix);
      _color.setHex(v.color);
      this.mesh!.setColorAt(i, _color);
    });

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.group.add(this.mesh);
  }

  buildFromModelFrame(model: VoxelModel, frameId: string): void {
    this.buildFromVoxels(voxelsFromFrame(model, frameId));
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** LRU-ish cache of baked frame meshes */
export class VoxelMeshCache {
  private cache = new Map<string, VoxelMesh>();
  private maxSize = 128;

  get(key: string): VoxelMesh | undefined {
    return this.cache.get(key);
  }

  getOrBake(
    key: string,
    model: VoxelModel,
    frameId: string,
    bevel: number,
  ): VoxelMesh {
    let mesh = this.cache.get(key);
    if (mesh) return mesh;
    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first) {
        this.cache.get(first)?.dispose();
        this.cache.delete(first);
      }
    }
    mesh = new VoxelMesh(bevel);
    mesh.buildFromModelFrame(model, frameId);
    this.cache.set(key, mesh);
    return mesh;
  }

  clear(): void {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}

export function buildStaticVoxels(
  voxels: Array<{ x: number; y: number; z: number; color: number }>,
  bevel = 0.05,
): THREE.Group {
  const vm = new VoxelMesh(bevel);
  vm.buildFromVoxels(voxels);
  return vm.group;
}
