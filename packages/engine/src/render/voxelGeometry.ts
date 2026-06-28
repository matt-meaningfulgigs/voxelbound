import * as THREE from 'three';
import { VOXEL_UNIT } from '@voxelbound/shared';

let unitBoxCenter: THREE.BoxGeometry | null = null;
let unitBoxBase: THREE.BoxGeometry | null = null;

/** Shared 1×1×1 world-voxel box (pivot at geometric center). */
export function unitVoxelGeometry(): THREE.BoxGeometry {
  if (!unitBoxCenter) {
    unitBoxCenter = new THREE.BoxGeometry(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    // InstancedMesh tints multiply instanceColor × vertex color; without this
    // attribute the shader reads black and every particle renders solid black.
    const n = unitBoxCenter.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    colors.fill(1);
    unitBoxCenter.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return unitBoxCenter;
}

/** Shared 1×1×1 world-voxel box with pivot at the bottom face (grass, particles). */
export function unitVoxelGeometryBasePivot(): THREE.BoxGeometry {
  if (!unitBoxBase) {
    unitBoxBase = new THREE.BoxGeometry(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    unitBoxBase.translate(0, VOXEL_UNIT / 2, 0);
  }
  return unitBoxBase;
}

/** Instanced particle / droplet scale — always exactly one voxel cube. */
export function uniformVoxelInstanceScale(): THREE.Vector3 {
  return new THREE.Vector3(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
}

/** Instanced column scale — one voxel wide/deep, arbitrary height in voxel units. */
export function voxelColumnInstanceScale(heightInUnits: number): THREE.Vector3 {
  return new THREE.Vector3(VOXEL_UNIT, heightInUnits * VOXEL_UNIT, VOXEL_UNIT);
}

/** Center of a voxel at integer grid coordinates (matches {@link VoxelMesh}). */
export function voxelCenter(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(
    x * VOXEL_UNIT + VOXEL_UNIT / 2,
    y * VOXEL_UNIT + VOXEL_UNIT / 2,
    z * VOXEL_UNIT + VOXEL_UNIT / 2,
  );
}
