import * as THREE from 'three';
import type { CameraConfig, RenderConfig, WorldSettings } from '@voxelbound/shared';

export class GameCamera {
  readonly camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  private config: CameraConfig;
  private target = new THREE.Vector3();

  constructor(settings: WorldSettings) {
    this.config = settings.camera;
    if (settings.camera.projection === 'perspective') {
      this.camera = new THREE.PerspectiveCamera(
        settings.camera.fovDeg,
        1,
        0.1,
        2000,
      );
    } else {
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    }
    this.applyConfig(settings.camera);
  }

  applySettings(settings: WorldSettings): void {
    this.config = settings.camera;
    this.applyConfig(settings.camera);
  }

  private applyConfig(cfg: CameraConfig): void {
    const pitch = THREE.MathUtils.degToRad(cfg.pitchDeg);
    const yaw = THREE.MathUtils.degToRad(cfg.yawDeg);
    const dist = cfg.viewHeightVoxels * cfg.zoom;
    this.camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.lookAt(this.target);
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    const h = this.config.viewHeightVoxels * this.config.zoom;
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.camera.left = (-h * aspect) / 2;
      this.camera.right = (h * aspect) / 2;
      this.camera.top = h / 2;
      this.camera.bottom = -h / 2;
      this.camera.updateProjectionMatrix();
    } else if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  follow(x: number, y: number, z: number, smoothing: number): void {
    this.target.x += (x - this.target.x) * smoothing;
    this.target.y += (y - this.target.y) * smoothing;
    this.target.z += (z - this.target.z) * smoothing;
    const pitch = THREE.MathUtils.degToRad(this.config.pitchDeg);
    const yaw = THREE.MathUtils.degToRad(this.config.yawDeg);
    const dist = this.config.viewHeightVoxels * this.config.zoom;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      this.target.y + Math.sin(pitch) * dist,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.lookAt(this.target);
  }
}

export function setupLighting(
  scene: THREE.Scene,
  render: RenderConfig,
): { ambient: THREE.AmbientLight; dir: THREE.DirectionalLight } {
  const ambient = new THREE.AmbientLight(0xffffff, render.ambientIntensity);
  scene.add(ambient);
  const az = THREE.MathUtils.degToRad(render.dirLight.azimuthDeg);
  const el = THREE.MathUtils.degToRad(render.dirLight.elevationDeg);
  const dir = new THREE.DirectionalLight(0xffffff, render.dirLight.intensity);
  dir.position.set(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  );
  scene.add(dir);
  return { ambient, dir };
}
