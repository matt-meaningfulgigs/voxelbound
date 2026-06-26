import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VoxelMesh } from '@voxelbound/engine';
import { useEditor, modelFromDoc } from './editorStore';

/** Live 3D preview of the current model with orbit + tick-accurate playback. */
export function VoxelPreview3D({ playing, animRate }: { playing: boolean; animRate: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<VoxelMesh | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rigRef = useRef<THREE.Group | null>(null);
  const yawPitch = useRef({ yaw: 0.7, pitch: 0.5, dist: 0 });

  const doc = useEditor((s) => s.doc);
  const bump = useEditor((s) => s.bump);
  const activeClip = useEditor((s) => s.activeClip);
  const activeFrame = useEditor((s) => s.activeFrame);

  // setup
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14161f);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(0.5, 1, 0.4);
    scene.add(dir);
    const rig = new THREE.Group();
    scene.add(rig);

    // ground grid sized to the model footprint
    const b0 = useEditor.getState().doc.bounds;
    const gridSize = Math.max(b0[0], b0[2]) * 1.6;
    const grid = new THREE.GridHelper(gridSize, Math.max(4, Math.round(gridSize / 4)), 0x444a5a, 0x232838);
    rig.add(grid);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    rigRef.current = rig;

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // orbit controls (manual)
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      yawPitch.current.yaw -= (e.clientX - lx) * 0.01;
      yawPitch.current.pitch = Math.max(-1.3, Math.min(1.3, yawPitch.current.pitch + (e.clientY - ly) * 0.01));
      lx = e.clientX;
      ly = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      yawPitch.current.dist *= 1 + Math.sign(e.deltaY) * 0.1;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let frameIdx = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = now - last;
      last = now;

      // playback advances the visible frame on the slow anim clock
      const st = useEditor.getState();
      const clip = st.doc.animations[st.activeClip];
      if (clip) {
        if (playing) {
          acc += dt;
          const hold = 1000 / animRate;
          if (acc >= hold) {
            acc = 0;
            frameIdx = (frameIdx + 1) % clip.frames.length;
            rebuild(clip.frames[frameIdx]!);
          }
        }
      }

      // camera orbit around model center
      const { yaw, pitch, dist } = yawPitch.current;
      const b = st.doc.bounds;
      const radius = dist || Math.max(b[0], b[1], b[2]) * 1.7;
      yawPitch.current.dist = radius;
      const cy = b[1] / 2;
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * radius,
        cy + Math.sin(pitch) * radius,
        Math.cos(yaw) * Math.cos(pitch) * radius,
      );
      camera.lookAt(0, cy, 0);
      renderer.render(scene, camera);
    };

    const rebuild = (frameId: string) => {
      const model = modelFromDoc(useEditor.getState().doc);
      if (!meshRef.current) {
        meshRef.current = new VoxelMesh(0.04);
        rig.add(meshRef.current.group);
      }
      meshRef.current.buildFromModelFrame(model, frameId);
      const b = model.bounds;
      meshRef.current.group.position.set(-b[0] / 2, 0, -b[2] / 2);
    };

    // initial
    rebuild(useEditor.getState().frameId());
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      meshRef.current?.dispose();
      meshRef.current = null;
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [playing, animRate]);

  // rebuild on edits / frame change while paused
  useEffect(() => {
    if (playing) return;
    const mesh = meshRef.current;
    const rig = rigRef.current;
    if (!rig) return;
    const model = modelFromDoc(doc);
    if (!mesh) {
      const m = new VoxelMesh(0.04);
      rig.add(m.group);
      meshRef.current = m;
    }
    const fid = useEditor.getState().frameId();
    meshRef.current!.buildFromModelFrame(model, fid);
    meshRef.current!.group.position.set(-model.bounds[0] / 2, 0, -model.bounds[2] / 2);
  }, [doc, bump, activeClip, activeFrame, playing]);

  return <div ref={mountRef} className="preview3d" />;
}
