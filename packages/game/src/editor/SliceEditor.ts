import type { EditorDoc } from './voxelDoc';
import { vkey } from './voxelDoc';

export type SliceTool = 'pen' | 'eraser' | 'fill' | 'line' | 'rect' | 'pick';

/**
 * Voxatron-style slice editor. The model is built one horizontal layer at a
 * time: the canvas shows a top-down 2D grid of the current Y layer (x across,
 * z down). The layer below is drawn as a faint "onion-skin" for alignment, and
 * a live 3D preview (handled separately) shows the stacked result. This removes
 * the depth ambiguity of free-orbit voxel placement.
 */
export class SliceEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mounted: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;

  private doc: EditorDoc;
  private frameId = 'idle_0';
  private layer = 0;
  private activeColor = 0;
  private tool: SliceTool = 'pen';
  private mirrorX = false;

  private cell = 16;
  private originX = 0;
  private originY = 0;

  private hover: [number, number] | null = null;
  private stroke: { start: [number, number]; last: [number, number]; button: number } | null = null;

  private undoStack: Array<{ frameId: string; data: Array<[string, number]> }> = [];
  private redoStack: Array<{ frameId: string; data: Array<[string, number]> }> = [];

  onChange: (() => void) | null = null;
  onLayerChange: ((y: number, max: number) => void) | null = null;

  constructor(doc: EditorDoc) {
    this.doc = doc;
    this.frameId = Object.keys(doc.frames)[0] ?? 'idle_0';
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.cursor = 'crosshair';
    this.canvas.style.touchAction = 'none';
    this.ctx = this.canvas.getContext('2d')!;
    this.layer = 0;
  }

  // -- lifecycle ------------------------------------------------------------

  mount(container: HTMLElement): void {
    this.mounted = container;
    container.appendChild(this.canvas);
    this.attachEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  dispose(): void {
    this.ro?.disconnect();
    if (this.mounted && this.canvas.parentElement === this.mounted) {
      this.mounted.removeChild(this.canvas);
    }
  }

  private resize(): void {
    const c = this.mounted;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.computeLayout(w, h);
    this.draw();
  }

  private computeLayout(w: number, h: number): void {
    const bx = this.doc.bounds[0];
    const bz = this.doc.bounds[2];
    const pad = 24;
    this.cell = Math.max(4, Math.floor(Math.min((w - pad * 2) / bx, (h - pad * 2) / bz)));
    this.originX = Math.floor((w - this.cell * bx) / 2);
    this.originY = Math.floor((h - this.cell * bz) / 2);
  }

  // -- state setters --------------------------------------------------------

  setDoc(doc: EditorDoc): void {
    this.doc = doc;
    this.frameId = Object.keys(doc.frames)[0] ?? 'idle_0';
    this.layer = Math.min(this.layer, doc.bounds[1] - 1);
    this.undoStack = [];
    this.redoStack = [];
    const c = this.mounted;
    if (c) this.computeLayout(c.clientWidth, c.clientHeight);
    this.emitLayer();
    this.draw();
  }

  setFrame(frameId: string): void {
    this.frameId = frameId;
    this.draw();
  }
  setActiveColor(i: number): void {
    this.activeColor = i;
  }
  setTool(t: SliceTool): void {
    this.tool = t;
  }
  setMirror(b: boolean): void {
    this.mirrorX = b;
    this.draw();
  }

  setLayer(y: number): void {
    this.layer = Math.max(0, Math.min(this.doc.bounds[1] - 1, y));
    this.emitLayer();
    this.draw();
  }
  layerUp(): void {
    this.setLayer(this.layer + 1);
  }
  layerDown(): void {
    this.setLayer(this.layer - 1);
  }
  getLayer(): number {
    return this.layer;
  }
  private emitLayer(): void {
    this.onLayerChange?.(this.layer, this.doc.bounds[1]);
  }

  boundsChanged(): void {
    this.layer = Math.min(this.layer, this.doc.bounds[1] - 1);
    const c = this.mounted;
    if (c) this.computeLayout(c.clientWidth, c.clientHeight);
    this.emitLayer();
    this.draw();
  }
  refreshColors(): void {
    this.draw();
  }

  voxelCount(): number {
    return this.frameMap().size;
  }
  currentFrameId(): string {
    return this.frameId;
  }

  // -- model access ---------------------------------------------------------

  private frameMap(): Map<string, number> {
    let m = this.doc.frames[this.frameId];
    if (!m) {
      m = new Map();
      this.doc.frames[this.frameId] = m;
    }
    return m;
  }

  private inBounds(x: number, z: number): boolean {
    return x >= 0 && x < this.doc.bounds[0] && z >= 0 && z < this.doc.bounds[2];
  }

  private snapshot(): void {
    const map = this.frameMap();
    this.undoStack.push({ frameId: this.frameId, data: [...map.entries()] });
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const last = this.undoStack.pop();
    if (!last) return;
    const cur = this.doc.frames[last.frameId] ?? new Map();
    this.redoStack.push({ frameId: last.frameId, data: [...cur.entries()] });
    this.doc.frames[last.frameId] = new Map(last.data);
    this.afterMutate();
  }
  redo(): void {
    const last = this.redoStack.pop();
    if (!last) return;
    const cur = this.doc.frames[last.frameId] ?? new Map();
    this.undoStack.push({ frameId: last.frameId, data: [...cur.entries()] });
    this.doc.frames[last.frameId] = new Map(last.data);
    this.afterMutate();
  }
  clearFrame(): void {
    this.snapshot();
    this.frameMap().clear();
    this.afterMutate();
  }
  /** Clear just the current layer. */
  clearLayer(): void {
    this.snapshot();
    const map = this.frameMap();
    for (const k of [...map.keys()]) {
      const [, y] = k.split(',').map(Number);
      if (y === this.layer) map.delete(k);
    }
    this.afterMutate();
  }

  private set(x: number, z: number, ci: number | null): void {
    const map = this.frameMap();
    const apply = (xx: number) => {
      if (!this.inBounds(xx, z)) return;
      if (ci === null) map.delete(vkey(xx, this.layer, z));
      else map.set(vkey(xx, this.layer, z), ci);
    };
    apply(x);
    if (this.mirrorX) apply(this.doc.bounds[0] - 1 - x);
  }

  private get(x: number, z: number): number | undefined {
    return this.frameMap().get(vkey(x, this.layer, z));
  }

  private afterMutate(): void {
    this.draw();
    this.onChange?.();
  }

  // -- tools ----------------------------------------------------------------

  private floodFill(sx: number, sz: number, replace: number | undefined, ci: number | null): void {
    const target = replace;
    const stack: Array<[number, number]> = [[sx, sz]];
    const seen = new Set<string>();
    while (stack.length) {
      const [x, z] = stack.pop()!;
      if (!this.inBounds(x, z)) continue;
      const key = `${x},${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.get(x, z) !== target) continue;
      this.set(x, z, ci);
      stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
  }

  private lineCells(a: [number, number], b: [number, number]): Array<[number, number]> {
    const cells: Array<[number, number]> = [];
    let [x0, z0] = a;
    const [x1, z1] = b;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (;;) {
      cells.push([x0, z0]);
      if (x0 === x1 && z0 === z1) break;
      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
      }
    }
    return cells;
  }

  private rectCells(a: [number, number], b: [number, number]): Array<[number, number]> {
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const z0 = Math.min(a[1], b[1]);
    const z1 = Math.max(a[1], b[1]);
    const cells: Array<[number, number]> = [];
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (x === x0 || x === x1 || z === z0 || z === z1) cells.push([x, z]);
      }
    }
    return cells;
  }

  // -- interaction ----------------------------------------------------------

  private cellAt(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left - this.originX;
    const py = clientY - rect.top - this.originY;
    const x = Math.floor(px / this.cell);
    const z = Math.floor(py / this.cell);
    if (!this.inBounds(x, z)) return null;
    return [x, z];
  }

  private attachEvents(): void {
    const dom = this.canvas;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      const cell = this.cellAt(e.clientX, e.clientY);
      if (!cell) return;
      const erase = e.button === 2;

      if (this.tool === 'pick' && !erase) {
        const ci = this.get(cell[0], cell[1]);
        if (ci !== undefined) {
          this.activeColor = ci;
          this.onChange?.();
        }
        return;
      }
      if (this.tool === 'fill' && !erase) {
        this.snapshot();
        this.floodFill(cell[0], cell[1], this.get(cell[0], cell[1]), this.activeColor);
        this.afterMutate();
        return;
      }
      // pen / eraser / line / rect all begin a stroke
      this.snapshot();
      this.stroke = { start: cell, last: cell, button: e.button };
      if (this.tool === 'pen' || this.tool === 'eraser') {
        this.set(cell[0], cell[1], erase || this.tool === 'eraser' ? null : this.activeColor);
        this.afterMutate();
      } else {
        this.draw();
      }
    });
    dom.addEventListener('pointermove', (e) => {
      const cell = this.cellAt(e.clientX, e.clientY);
      this.hover = cell;
      if (this.stroke && cell) {
        const erase = this.stroke.button === 2 || this.tool === 'eraser';
        if (this.tool === 'pen' || this.tool === 'eraser') {
          for (const [x, z] of this.lineCells(this.stroke.last, cell)) {
            this.set(x, z, erase ? null : this.activeColor);
          }
          this.stroke.last = cell;
          this.afterMutate();
        } else {
          // line / rect: live preview only
          this.stroke.last = cell;
          this.draw();
        }
      } else {
        this.draw();
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (this.stroke) {
        const cell = this.cellAt(e.clientX, e.clientY) ?? this.stroke.last;
        const erase = this.stroke.button === 2 || this.tool === 'eraser';
        const ci = erase ? null : this.activeColor;
        if (this.tool === 'line') {
          for (const [x, z] of this.lineCells(this.stroke.start, cell)) this.set(x, z, ci);
          this.afterMutate();
        } else if (this.tool === 'rect') {
          for (const [x, z] of this.rectCells(this.stroke.start, cell)) this.set(x, z, ci);
          this.afterMutate();
        }
      }
      this.stroke = null;
    });
    dom.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) this.layerUp();
      else this.layerDown();
    }, { passive: false });
  }

  // -- rendering ------------------------------------------------------------

  private draw(): void {
    const ctx = this.ctx;
    const bx = this.doc.bounds[0];
    const bz = this.doc.bounds[2];
    const cs = this.cell;
    const ox = this.originX;
    const oy = this.originY;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // board background
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#161b28';
    ctx.fillRect(ox, oy, cs * bx, cs * bz);

    const map = this.frameMap();

    // onion-skin: layer below (faint)
    if (this.layer > 0) {
      ctx.globalAlpha = 0.18;
      for (const [k, ci] of map) {
        const [x, y, z] = k.split(',').map(Number) as [number, number, number];
        if (y !== this.layer - 1) continue;
        ctx.fillStyle = this.doc.palette[ci] ?? '#ff00ff';
        ctx.fillRect(ox + x * cs, oy + z * cs, cs, cs);
      }
      ctx.globalAlpha = 1;
    }

    // current layer cells
    for (const [k, ci] of map) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      if (y !== this.layer) continue;
      ctx.fillStyle = this.doc.palette[ci] ?? '#ff00ff';
      ctx.fillRect(ox + x * cs, oy + z * cs, cs, cs);
    }

    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= bx; x++) {
      ctx.moveTo(ox + x * cs + 0.5, oy);
      ctx.lineTo(ox + x * cs + 0.5, oy + bz * cs);
    }
    for (let z = 0; z <= bz; z++) {
      ctx.moveTo(ox, oy + z * cs + 0.5);
      ctx.lineTo(ox + bx * cs, oy + z * cs + 0.5);
    }
    ctx.stroke();

    // center axes
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    const midX = ox + Math.floor(bx / 2) * cs + 0.5;
    const midZ = oy + Math.floor(bz / 2) * cs + 0.5;
    ctx.moveTo(midX, oy);
    ctx.lineTo(midX, oy + bz * cs);
    ctx.moveTo(ox, midZ);
    ctx.lineTo(ox + bx * cs, midZ);
    ctx.stroke();

    // mirror plane indicator
    if (this.mirrorX) {
      ctx.strokeStyle = '#ffd23a';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const mx = ox + (bx / 2) * cs + 0.5;
      ctx.moveTo(mx, oy);
      ctx.lineTo(mx, oy + bz * cs);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // line / rect live preview
    if (this.stroke && (this.tool === 'line' || this.tool === 'rect')) {
      const cells = this.tool === 'line'
        ? this.lineCells(this.stroke.start, this.stroke.last)
        : this.rectCells(this.stroke.start, this.stroke.last);
      ctx.fillStyle = this.stroke.button === 2 ? 'rgba(240,85,109,0.6)' : this.colorWithAlpha(this.activeColor, 0.6);
      for (const [x, z] of cells) ctx.fillRect(ox + x * cs, oy + z * cs, cs, cs);
    }

    // hover cursor
    if (this.hover && !this.stroke) {
      const [hx, hz] = this.hover;
      ctx.strokeStyle = this.tool === 'eraser' ? '#f0556d' : '#6df06d';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + hx * cs + 1, oy + hz * cs + 1, cs - 2, cs - 2);
      if (this.mirrorX) {
        const mxc = this.doc.bounds[0] - 1 - hx;
        ctx.strokeStyle = 'rgba(255,210,58,0.7)';
        ctx.strokeRect(ox + mxc * cs + 1, oy + hz * cs + 1, cs - 2, cs - 2);
      }
    }
  }

  private colorWithAlpha(ci: number, a: number): string {
    const hex = this.doc.palette[ci] ?? '#ff00ff';
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return `rgba(255,0,255,${a})`;
    return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
  }
}
