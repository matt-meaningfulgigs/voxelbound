import * as THREE from 'three';
import { VOXEL_UNIT } from '@voxelbound/shared';
import type { EditorDoc } from './voxelDoc';
import { vkey } from './voxelDoc';

export type EditorTool = 'place' | 'erase' | 'paint' | 'pick';

/**
 * A direct-manipulation 3D voxel editor. Renders the active frame as an
 * InstancedMesh of unit cubes, lets the user orbit the model, and add / remove
 * / recolor voxels by clicking faces (raycasting). The first voxel can be
 * placed on the ground plane when the model is empty.
 */
export class VoxelEditor3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  private rig = new THREE.Group();
  private inst: THREE.InstancedMesh | null = null;
  private coords: Array<[number, number, number]> = [];
  private cube = new THREE.BoxGeometry(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
  private cubeMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  private floor: THREE.Mesh;
  private cursor: THREE.LineSegments;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private mounted: HTMLElement | null = null;

  private doc: EditorDoc;
  private frameId = 'idle_0';
  private activeColor = 0;
  private tool: EditorTool = 'place';
  private mirrorX = false;

  private orbit = { yaw: 0.8, pitch: 0.6, dist: 0 };
  private down: { x: number; y: number; button: number } | null = null;
  private dragging = false;

  /** Preview mode: no editing, slow auto-rotation, drag only orbits. */
  previewOnly = false;
  private autoSpin = true;

  private undoStack: Array<{ frameId: string; data: Array<[string, number]> }> = [];
  private redoStack: Array<{ frameId: string; data: Array<[string, number]> }> = [];

  onChange: (() => void) | null = null;

  constructor(doc: EditorDoc) {
    this.doc = doc;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x10131c);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(0.6, 1, 0.4);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.25);
    dir2.position.set(-0.5, 0.4, -0.6);
    this.scene.add(dir2);
    this.scene.add(this.rig);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x1c2030, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.rig.add(this.floor);

    const edges = new THREE.EdgesGeometry(this.cube);
    this.cursor = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x6df06d }));
    this.cursor.visible = false;
    this.cursor.scale.setScalar(1.04);
    this.scene.add(this.cursor);

    this.frameId = Object.keys(doc.frames)[0] ?? 'idle_0';
  }

  // -- lifecycle ------------------------------------------------------------

  mount(container: HTMLElement): void {
    this.mounted = container;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.attachEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.resetView();
    this.rebuildFloor();
    this.rebuild();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.inst?.dispose();
    this.cube.dispose();
    this.cubeMat.dispose();
    this.renderer.dispose();
    if (this.mounted && this.renderer.domElement.parentElement === this.mounted) {
      this.mounted.removeChild(this.renderer.domElement);
    }
  }

  private resize(): void {
    const c = this.mounted;
    if (!c) return;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resetView(): void {
    const b = this.doc.bounds;
    this.orbit.yaw = 0.8;
    this.orbit.pitch = 0.55;
    this.orbit.dist = Math.max(b[0], b[1], b[2]) * 1.9;
  }

  // -- state setters --------------------------------------------------------

  setDoc(doc: EditorDoc): void {
    this.doc = doc;
    this.frameId = Object.keys(doc.frames)[0] ?? 'idle_0';
    this.undoStack = [];
    this.redoStack = [];
    this.resetView();
    this.rebuildFloor();
    this.rebuild();
  }

  setFrame(frameId: string): void {
    this.frameId = frameId;
    this.rebuild();
  }

  setActiveColor(i: number): void {
    this.activeColor = i;
  }
  getActiveColor(): number {
    return this.activeColor;
  }
  setTool(t: EditorTool): void {
    this.tool = t;
    (this.cursor.material as THREE.LineBasicMaterial).color.setHex(t === 'erase' ? 0xf0556d : 0x6df06d);
  }
  setMirror(b: boolean): void {
    this.mirrorX = b;
  }

  // -- geometry rebuild -----------------------------------------------------

  private center(): [number, number] {
    return [this.doc.bounds[0] / 2, this.doc.bounds[2] / 2];
  }

  private rebuildFloor(): void {
    const b = this.doc.bounds;
    const size = Math.max(b[0], b[2]);
    this.floor.geometry.dispose();
    this.floor.geometry = new THREE.PlaneGeometry(size, size);
    this.floor.position.set(0, 0, 0);
  }

  private frameMap(): Map<string, number> {
    let m = this.doc.frames[this.frameId];
    if (!m) {
      m = new Map();
      this.doc.frames[this.frameId] = m;
    }
    return m;
  }

  private rebuild(): void {
    if (this.inst) {
      this.rig.remove(this.inst);
      this.inst.dispose();
      this.inst = null;
    }
    const map = this.frameMap();
    this.coords = [];
    const [cx, cz] = this.center();
    const count = map.size;
    const inst = new THREE.InstancedMesh(this.cube, this.cubeMat, Math.max(1, count));
    inst.count = count;
    const mat = new THREE.Matrix4();
    const color = new THREE.Color();
    let i = 0;
    for (const [k, ci] of map) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      this.coords.push([x, y, z]);
      mat.makeTranslation(x + 0.5 - cx, y + 0.5, z + 0.5 - cz);
      inst.setMatrixAt(i, mat);
      color.set(this.doc.palette[ci] ?? '#ff00ff');
      inst.setColorAt(i, color);
      i++;
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.rig.add(inst);
    this.inst = inst;
    this.onChange?.();
  }

  // -- editing --------------------------------------------------------------

  private inBounds(x: number, y: number, z: number): boolean {
    const b = this.doc.bounds;
    return x >= 0 && x < b[0] && y >= 0 && y < b[1] && z >= 0 && z < b[2];
  }

  private snapshot(): void {
    const map = this.frameMap();
    this.undoStack.push({ frameId: this.frameId, data: [...map.entries()] });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  private setVoxel(x: number, y: number, z: number, ci: number | null): void {
    const map = this.frameMap();
    const apply = (xx: number) => {
      if (!this.inBounds(xx, y, z)) return;
      if (ci === null) map.delete(vkey(xx, y, z));
      else map.set(vkey(xx, y, z), ci);
    };
    apply(x);
    if (this.mirrorX) apply(this.doc.bounds[0] - 1 - x);
  }

  undo(): void {
    const last = this.undoStack.pop();
    if (!last) return;
    const cur = this.doc.frames[last.frameId] ?? new Map();
    this.redoStack.push({ frameId: last.frameId, data: [...cur.entries()] });
    this.doc.frames[last.frameId] = new Map(last.data);
    if (last.frameId === this.frameId) this.rebuild();
  }
  redo(): void {
    const last = this.redoStack.pop();
    if (!last) return;
    const cur = this.doc.frames[last.frameId] ?? new Map();
    this.undoStack.push({ frameId: last.frameId, data: [...cur.entries()] });
    this.doc.frames[last.frameId] = new Map(last.data);
    if (last.frameId === this.frameId) this.rebuild();
  }

  clearFrame(): void {
    this.snapshot();
    this.frameMap().clear();
    this.rebuild();
  }

  // -- raycasting / interaction --------------------------------------------

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /** Returns the target cell for an action and whether it came from a voxel hit. */
  private pick(clientX: number, clientY: number): { add: [number, number, number]; hit: [number, number, number] | null } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const [cx, cz] = this.center();

    if (this.inst && this.inst.count > 0) {
      const hits = ray.intersectObject(this.inst);
      if (hits.length) {
        const h = hits[0]!;
        const id = h.instanceId ?? -1;
        const coord = this.coords[id];
        if (coord && h.face) {
          const n = h.face.normal;
          const add: [number, number, number] = [coord[0] + Math.round(n.x), coord[1] + Math.round(n.y), coord[2] + Math.round(n.z)];
          return { add, hit: coord };
        }
      }
    }
    // fall back to the ground plane for the first voxel
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, pt)) {
      const gx = Math.floor(pt.x + cx);
      const gz = Math.floor(pt.z + cz);
      return { add: [gx, 0, gz], hit: null };
    }
    return null;
  }

  private updateCursor(clientX: number, clientY: number): void {
    const r = this.pick(clientX, clientY);
    if (!r) {
      this.cursor.visible = false;
      return;
    }
    const target = this.tool === 'erase' || this.tool === 'paint' || this.tool === 'pick' ? r.hit ?? r.add : r.add;
    if (!this.inBounds(target[0], target[1], target[2])) {
      this.cursor.visible = false;
      return;
    }
    const [cx, cz] = this.center();
    this.cursor.position.set(target[0] + 0.5 - cx, target[1] + 0.5, target[2] + 0.5 - cz);
    this.cursor.visible = true;
  }

  private performClick(clientX: number, clientY: number, button: number): void {
    if (this.previewOnly) return;
    const r = this.pick(clientX, clientY);
    if (!r) return;
    const tool: EditorTool = button === 2 ? 'erase' : this.tool;

    if (tool === 'pick') {
      if (r.hit) {
        const ci = this.frameMap().get(vkey(...r.hit));
        if (ci !== undefined) {
          this.activeColor = ci;
          this.onChange?.();
        }
      }
      return;
    }
    if (tool === 'place') {
      if (!this.inBounds(...r.add)) return;
      this.snapshot();
      this.setVoxel(r.add[0], r.add[1], r.add[2], this.activeColor);
      this.rebuild();
    } else if (tool === 'erase') {
      if (!r.hit) return;
      this.snapshot();
      this.setVoxel(r.hit[0], r.hit[1], r.hit[2], null);
      this.rebuild();
    } else if (tool === 'paint') {
      if (!r.hit) return;
      this.snapshot();
      this.setVoxel(r.hit[0], r.hit[1], r.hit[2], this.activeColor);
      this.rebuild();
    }
  }

  private attachEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
      this.dragging = false;
      this.autoSpin = false;
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.down) {
        const dx = e.clientX - this.down.x;
        const dy = e.clientY - this.down.y;
        if (!this.dragging && Math.hypot(dx, dy) > 4) this.dragging = true;
        if (this.dragging) {
          this.orbit.yaw -= dx * 0.01;
          this.orbit.pitch = Math.max(-1.4, Math.min(1.4, this.orbit.pitch + dy * 0.01));
          this.down.x = e.clientX;
          this.down.y = e.clientY;
          this.cursor.visible = false;
        }
      } else if (!this.previewOnly) {
        this.updateCursor(e.clientX, e.clientY);
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (this.down && !this.dragging) this.performClick(e.clientX, e.clientY, this.down.button);
      this.down = null;
      this.dragging = false;
    });
    dom.addEventListener('pointerleave', () => {
      this.cursor.visible = false;
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.dist = Math.max(4, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1));
    }, { passive: false });
  }

  private updateCamera(): void {
    const b = this.doc.bounds;
    if (this.previewOnly && this.autoSpin) this.orbit.yaw += 0.006;
    const { yaw, pitch, dist } = this.orbit;
    const cy = b[1] / 2;
    this.camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      cy + Math.sin(pitch) * dist,
      Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.lookAt(0, cy, 0);
  }

  /** Re-fit the ground plane and instances after bounds change. */
  boundsChanged(): void {
    this.rebuildFloor();
    this.rebuild();
  }

  /** Recolor instances after a palette edit (no topology change). */
  refreshColors(): void {
    this.rebuild();
  }

  /** Rebuild geometry from the doc (after external edits, e.g. slice editor). */
  refresh(): void {
    this.rebuild();
  }

  voxelCount(): number {
    return this.frameMap().size;
  }
  currentFrameId(): string {
    return this.frameId;
  }
}
