import type { GameEngine } from '@voxelbound/engine';
import { allModels, ITEMS, ENEMIES, type VoxelModel } from '@voxelbound/shared';
import { el, clear } from '../game/dom';
import { VoxelEditor3D } from './VoxelEditor3D';
import { SliceEditor, type SliceTool } from './SliceEditor';
import {
  type EditorDoc,
  type VoxelKind,
  emptyDoc,
  docFromModel,
  modelFromDoc,
  loadLibrary,
  saveToLibrary,
  PRESETS,
} from './voxelDoc';

type Tab = 'voxel' | 'world' | 'data';

const TOOLS: Array<{ id: SliceTool; label: string; key: string }> = [
  { id: 'pen', label: 'Pen', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Box', key: 'R' },
  { id: 'pick', label: 'Pick', key: 'I' },
];

const KINDS: VoxelKind[] = ['character', 'item', 'prop', 'tile', 'interactive'];

export class EditorOverlay {
  private engine: GameEngine;
  private onClose: () => void;
  private toast: (m: string) => void;

  private root: HTMLElement;
  private tab: Tab = 'voxel';
  private open = false;

  private doc: EditorDoc = emptyDoc('character');
  private slice: SliceEditor | null = null;
  private preview: VoxelEditor3D | null = null;
  private slicePane!: HTMLElement;
  private previewPane!: HTMLElement;
  private viewport!: HTMLElement;
  private sidebar!: HTMLElement;
  private body!: HTMLElement;
  private tabBar!: HTMLElement;

  // voxel tab editing state
  private activeClip = 'idle';
  private activeFrame = 0;
  private activeColor = 0;
  private tool: SliceTool = 'pen';
  private mirror = false;
  private playTimer: number | null = null;

  // world tab state
  private placeModelId = 'tree_medium_0';
  private placeSolid = true;
  private worldClickHandler: ((e: PointerEvent) => void) | null = null;
  private worldDown: { x: number; y: number } | null = null;

  constructor(engine: GameEngine, opts: { onClose: () => void; toast: (m: string) => void }) {
    this.engine = engine;
    this.onClose = opts.onClose;
    this.toast = opts.toast;
    this.root = el('div', { id: 'editor-overlay' });
    document.getElementById('ui')!.append(this.root);
    this.buildShell();
  }

  // -- open / close ---------------------------------------------------------

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('show');

    this.slice = new SliceEditor(this.doc);
    this.slice.onChange = () => {
      this.refreshCounts();
      this.preview?.refresh();
    };
    this.slice.onLayerChange = () => this.updateLayerLabel();
    this.slice.mount(this.slicePane);
    this.slice.setActiveColor(this.activeColor);
    this.slice.setTool(this.tool);
    this.slice.setMirror(this.mirror);

    this.preview = new VoxelEditor3D(this.doc);
    this.preview.previewOnly = true;
    this.preview.mount(this.previewPane);

    this.syncFrame();
    this.setTab('voxel');
    window.addEventListener('keydown', this.onEditorKey);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.stopPlay();
    this.exitWorldPlacement();
    window.removeEventListener('keydown', this.onEditorKey);
    this.slice?.dispose();
    this.slice = null;
    this.preview?.dispose();
    this.preview = null;
    this.root.classList.remove('show');
  }

  private onEditorKey = (e: KeyboardEvent): void => {
    if (!this.open || this.tab !== 'voxel') return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'BracketRight' || e.code === 'Equal') { this.slice?.layerUp(); e.preventDefault(); return; }
    if (e.code === 'BracketLeft' || e.code === 'Minus') { this.slice?.layerDown(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ') { e.shiftKey ? this.slice?.redo() : this.slice?.undo(); e.preventDefault(); return; }
      if (e.code === 'KeyY') { this.slice?.redo(); e.preventDefault(); return; }
    }
    const tool = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (tool) { this.tool = tool.id; this.slice?.setTool(tool.id); this.buildVoxelSidebar(); }
  };

  isOpen(): boolean {
    return this.open;
  }

  // -- shell ----------------------------------------------------------------

  private buildShell(): void {
    this.tabBar = el('div', { class: 'ed-tabs' });
    const tabs: Array<[Tab, string]> = [
      ['voxel', 'Character / Object'],
      ['world', 'World'],
      ['data', 'Data'],
    ];
    for (const [id, label] of tabs) {
      this.tabBar.append(
        el('button', { class: 'ed-tab', textContent: label, onclick: () => this.setTab(id) } as never),
      );
    }
    const spacer = el('div', { style: 'flex:1' } as never);
    const closeBtn = el('button', { class: 'ed-close', textContent: '✕ Exit Editor', onclick: () => this.onClose() } as never);
    const header = el('div', { class: 'ed-header' }, [
      el('div', { class: 'ed-logo', html: 'VOXELBOUND <span>EDITOR</span>' } as never),
      this.tabBar,
      spacer,
      closeBtn,
    ]);

    this.sidebar = el('div', { class: 'ed-sidebar' });
    this.slicePane = el('div', { class: 'ed-slice' });
    this.previewPane = el('div', { class: 'ed-preview' });
    const previewLabel = el('div', { class: 'ed-preview-tag', textContent: '3D preview · drag to rotate' });
    this.previewPane.append(previewLabel);
    this.viewport = el('div', { class: 'ed-viewport' }, [this.slicePane, this.previewPane]);
    this.body = el('div', { class: 'ed-body' }, [this.sidebar, this.viewport]);

    this.root.append(header, this.body);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    Array.from(this.tabBar.children).forEach((c, i) => {
      c.classList.toggle('sel', ['voxel', 'world', 'data'][i] === tab);
    });
    this.stopPlay();
    if (tab === 'world') this.enterWorldPlacement();
    else this.exitWorldPlacement();

    if (tab === 'voxel') {
      this.root.classList.remove('passthrough');
      this.viewport.style.display = 'flex';
      this.buildVoxelSidebar();
    } else if (tab === 'world') {
      // let clicks reach the live game canvas
      this.root.classList.add('passthrough');
      this.viewport.style.display = 'none';
      this.buildWorldSidebar();
    } else {
      this.root.classList.remove('passthrough');
      this.viewport.style.display = 'none';
      this.buildDataSidebar();
    }
  }

  // -- voxel tab ------------------------------------------------------------

  private buildVoxelSidebar(): void {
    clear(this.sidebar);

    // model meta
    const meta = el('div', { class: 'ed-block' });
    meta.append(el('div', { class: 'ed-title', textContent: 'Model' }));
    const idIn = el('input', { class: 'ed-in', value: this.doc.id }) as HTMLInputElement;
    idIn.addEventListener('input', () => (this.doc.id = idIn.value.replace(/\s+/g, '_')));
    meta.append(this.field('ID', idIn));

    const kindSel = el('select', { class: 'ed-in' }) as HTMLSelectElement;
    for (const k of KINDS) kindSel.append(el('option', { value: k, textContent: k }));
    kindSel.value = this.doc.kind;
    kindSel.addEventListener('change', () => (this.doc.kind = kindSel.value as VoxelKind));
    meta.append(this.field('Kind', kindSel));

    meta.append(this.boundsRow());

    const presetRow = el('div', { class: 'ed-btn-row' });
    for (const name of Object.keys(PRESETS)) {
      presetRow.append(el('button', { class: 'ed-btn', textContent: name, onclick: () => this.newFromPreset(name) } as never));
    }
    meta.append(el('div', { class: 'ed-sub', textContent: 'New' }), presetRow);

    const loadSel = el('select', { class: 'ed-in' }) as HTMLSelectElement;
    loadSel.append(el('option', { value: '', textContent: 'Load existing…' }));
    for (const m of [...allModels, ...loadLibrary()]) {
      loadSel.append(el('option', { value: m.id, textContent: `${m.id} (${m.kind})` }));
    }
    loadSel.addEventListener('change', () => {
      const m = [...allModels, ...loadLibrary()].find((x) => x.id === loadSel.value);
      if (m) this.loadModel(m);
    });
    meta.append(this.field('Open', loadSel));
    this.sidebar.append(meta);

    // tools
    const tools = el('div', { class: 'ed-block' });
    tools.append(el('div', { class: 'ed-title', textContent: 'Tools' }));
    const toolRow = el('div', { class: 'ed-btn-row' });
    for (const t of TOOLS) {
      toolRow.append(
        el('button', {
          class: 'ed-btn' + (this.tool === t.id ? ' sel' : ''),
          textContent: `${t.label} (${t.key})`,
          onclick: () => {
            this.tool = t.id;
            this.slice?.setTool(t.id);
            this.buildVoxelSidebar();
          },
        } as never),
      );
    }
    tools.append(toolRow);
    const toolRow2 = el('div', { class: 'ed-btn-row' });
    toolRow2.append(
      el('button', { class: 'ed-btn' + (this.mirror ? ' sel' : ''), textContent: 'Mirror X', onclick: () => { this.mirror = !this.mirror; this.slice?.setMirror(this.mirror); this.buildVoxelSidebar(); } } as never),
      el('button', { class: 'ed-btn', textContent: 'Undo', onclick: () => this.slice?.undo() } as never),
      el('button', { class: 'ed-btn', textContent: 'Redo', onclick: () => this.slice?.redo() } as never),
    );
    tools.append(toolRow2);
    this.sidebar.append(tools);

    // layers (Voxatron-style slice navigation)
    const layers = el('div', { class: 'ed-block' });
    layers.append(el('div', { class: 'ed-title', textContent: 'Layer (height)' }));
    const layRow = el('div', { class: 'ed-btn-row' });
    layRow.append(
      el('button', { class: 'ed-btn', textContent: '▼ Down', onclick: () => this.slice?.layerDown() } as never),
      el('span', { class: 'ed-frame-label', id: 'ed-layer-label', textContent: 'Y 0' }),
      el('button', { class: 'ed-btn', textContent: '▲ Up', onclick: () => this.slice?.layerUp() } as never),
    );
    layers.append(layRow);
    const laySlide = el('input', { class: 'ed-in', type: 'range', min: '0', max: String(this.doc.bounds[1] - 1), value: String(this.slice?.getLayer() ?? 0), id: 'ed-layer-slider' }) as HTMLInputElement;
    laySlide.addEventListener('input', () => this.slice?.setLayer(Number(laySlide.value)));
    layers.append(laySlide);
    const layRow2 = el('div', { class: 'ed-btn-row' });
    layRow2.append(
      el('button', { class: 'ed-btn', textContent: 'Clear layer', onclick: () => this.slice?.clearLayer() } as never),
      el('button', { class: 'ed-btn', textContent: 'Clear all', onclick: () => this.slice?.clearFrame() } as never),
      el('button', { class: 'ed-btn', textContent: 'Reset 3D', onclick: () => this.preview?.resetView() } as never),
    );
    layers.append(layRow2);
    layers.append(el('div', { class: 'ed-help', html: 'Paint the top-down grid for this height. [ and ] (or mouse wheel) change layers. The dim cells are the layer below.' } as never));
    this.sidebar.append(layers);

    // palette
    this.sidebar.append(this.paletteBlock());

    // frames
    this.sidebar.append(this.framesBlock());

    // export
    const exp = el('div', { class: 'ed-block' });
    exp.append(el('div', { class: 'ed-title', textContent: 'Save' }));
    const expRow = el('div', { class: 'ed-btn-row' });
    expRow.append(
      el('button', { class: 'ed-btn primary', textContent: 'Save to Library', onclick: () => this.saveLibrary() } as never),
      el('button', { class: 'ed-btn', textContent: 'Download JSON', onclick: () => this.exportJson() } as never),
    );
    exp.append(expRow);
    exp.append(el('div', { class: 'ed-help', id: 'ed-counts' }));
    this.sidebar.append(exp);
    this.refreshCounts();
    this.updateLayerLabel();
  }

  private updateLayerLabel(): void {
    const label = this.sidebar.querySelector('#ed-layer-label');
    if (label) label.textContent = `Y ${this.slice?.getLayer() ?? 0} / ${this.doc.bounds[1] - 1}`;
    const slider = this.sidebar.querySelector('#ed-layer-slider') as HTMLInputElement | null;
    if (slider) {
      slider.max = String(this.doc.bounds[1] - 1);
      slider.value = String(this.slice?.getLayer() ?? 0);
    }
  }

  private boundsRow(): HTMLElement {
    const wrap = el('div', { class: 'ed-field' }, [el('span', { textContent: 'Bounds' })]);
    const triple = el('div', { class: 'ed-triple' });
    ([0, 1, 2] as const).forEach((i) => {
      const inp = el('input', { class: 'ed-in', type: 'number', min: '1', max: '64', value: String(this.doc.bounds[i]) }) as HTMLInputElement;
      inp.addEventListener('change', () => {
        this.doc.bounds[i] = Math.max(1, Math.min(64, Number(inp.value)));
        this.slice?.boundsChanged();
        this.preview?.boundsChanged();
        this.updateLayerLabel();
      });
      triple.append(inp);
    });
    wrap.append(triple);
    return wrap;
  }

  private paletteBlock(): HTMLElement {
    const block = el('div', { class: 'ed-block' });
    block.append(el('div', { class: 'ed-title', textContent: 'Palette' }));
    const grid = el('div', { class: 'ed-palette' });
    this.doc.palette.forEach((c, i) => {
      const sw = el('button', { class: 'ed-swatch' + (i === this.activeColor ? ' sel' : ''), style: `background:${c}` } as never);
      sw.addEventListener('click', () => {
        this.activeColor = i;
        this.slice?.setActiveColor(i);
        this.buildVoxelSidebar();
      });
      grid.append(sw);
    });
    const add = el('button', { class: 'ed-swatch add', textContent: '+' });
    add.addEventListener('click', () => {
      this.doc.palette.push('#ffffff');
      this.buildVoxelSidebar();
    });
    grid.append(add);
    block.append(grid);

    const editRow = el('div', { class: 'ed-pal-edit' });
    const colorIn = el('input', { type: 'color', value: this.doc.palette[this.activeColor] ?? '#ffffff' }) as HTMLInputElement;
    colorIn.addEventListener('input', () => {
      this.doc.palette[this.activeColor] = colorIn.value;
      this.slice?.refreshColors();
      this.preview?.refreshColors();
      const sw = this.sidebar.querySelectorAll('.ed-swatch')[this.activeColor] as HTMLElement | undefined;
      if (sw) sw.style.background = colorIn.value;
    });
    editRow.append(colorIn, el('span', { class: 'ed-help', textContent: `slot #${this.activeColor}` }));
    block.append(editRow);
    return block;
  }

  private framesBlock(): HTMLElement {
    const block = el('div', { class: 'ed-block' });
    block.append(el('div', { class: 'ed-title', textContent: 'Animation' }));

    const clipRow = el('div', { class: 'ed-btn-row' });
    const clipSel = el('select', { class: 'ed-in' }) as HTMLSelectElement;
    for (const name of Object.keys(this.doc.animations)) clipSel.append(el('option', { value: name, textContent: name }));
    clipSel.value = this.activeClip;
    clipSel.addEventListener('change', () => {
      this.activeClip = clipSel.value;
      this.activeFrame = 0;
      this.syncFrame();
      this.buildVoxelSidebar();
    });
    clipRow.append(clipSel);
    clipRow.append(el('button', { class: 'ed-btn', textContent: '+clip', onclick: () => this.addClip() } as never));
    clipRow.append(el('button', { class: 'ed-btn', textContent: '−clip', onclick: () => this.deleteClip() } as never));
    block.append(clipRow);

    const clip = this.doc.animations[this.activeClip];
    const frameCount = clip?.frames.length ?? 1;
    const navRow = el('div', { class: 'ed-btn-row' });
    navRow.append(
      el('button', { class: 'ed-btn', textContent: '◀', onclick: () => { this.activeFrame = (this.activeFrame - 1 + frameCount) % frameCount; this.syncFrame(); this.buildVoxelSidebar(); } } as never),
      el('span', { class: 'ed-frame-label', textContent: `frame ${this.activeFrame + 1}/${frameCount}` }),
      el('button', { class: 'ed-btn', textContent: '▶', onclick: () => { this.activeFrame = (this.activeFrame + 1) % frameCount; this.syncFrame(); this.buildVoxelSidebar(); } } as never),
    );
    block.append(navRow);

    const frameRow = el('div', { class: 'ed-btn-row' });
    frameRow.append(
      el('button', { class: 'ed-btn', textContent: '+dup', onclick: () => this.addFrame(true) } as never),
      el('button', { class: 'ed-btn', textContent: '+new', onclick: () => this.addFrame(false) } as never),
      el('button', { class: 'ed-btn', textContent: '−', onclick: () => this.deleteFrame() } as never),
      el('button', { class: 'ed-btn', textContent: '▶ Play', onclick: () => this.togglePlay() } as never),
    );
    block.append(frameRow);
    return block;
  }

  private syncFrame(): void {
    const clip = this.doc.animations[this.activeClip];
    const fid = clip?.frames[this.activeFrame] ?? clip?.frames[0] ?? 'idle_0';
    this.slice?.setFrame(fid);
    this.preview?.setFrame(fid);
  }

  private addClip(): void {
    const name = prompt('New clip name (e.g. walk, attack):')?.trim();
    if (!name || this.doc.animations[name]) return;
    const fid = `${name}_0`;
    this.doc.animations[name] = { frames: [fid], ticksPerFrame: null, loop: 'loop' };
    this.doc.frames[fid] = new Map();
    this.activeClip = name;
    this.activeFrame = 0;
    this.syncFrame();
    this.buildVoxelSidebar();
  }

  private deleteClip(): void {
    if (Object.keys(this.doc.animations).length <= 1) return;
    delete this.doc.animations[this.activeClip];
    this.activeClip = Object.keys(this.doc.animations)[0]!;
    this.activeFrame = 0;
    this.syncFrame();
    this.buildVoxelSidebar();
  }

  private addFrame(copy: boolean): void {
    const clip = this.doc.animations[this.activeClip]!;
    let n = clip.frames.length;
    let fid = `${this.activeClip}_${n}`;
    while (this.doc.frames[fid]) fid = `${this.activeClip}_${++n}`;
    const cur = clip.frames[this.activeFrame];
    const src = cur ? this.doc.frames[cur] : undefined;
    this.doc.frames[fid] = copy && src ? new Map(src) : new Map();
    clip.frames.push(fid);
    this.activeFrame = clip.frames.length - 1;
    this.syncFrame();
    this.buildVoxelSidebar();
  }

  private deleteFrame(): void {
    const clip = this.doc.animations[this.activeClip]!;
    if (clip.frames.length <= 1) return;
    clip.frames.splice(this.activeFrame, 1);
    this.activeFrame = Math.max(0, this.activeFrame - 1);
    this.syncFrame();
    this.buildVoxelSidebar();
  }

  private togglePlay(): void {
    if (this.playTimer) {
      this.stopPlay();
      return;
    }
    const clip = this.doc.animations[this.activeClip];
    if (!clip || clip.frames.length < 2) return;
    this.playTimer = window.setInterval(() => {
      this.activeFrame = (this.activeFrame + 1) % clip.frames.length;
      this.syncFrame();
    }, 1000 / 3);
  }

  private stopPlay(): void {
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }

  private newFromPreset(name: string): void {
    const p = PRESETS[name]!;
    const doc = emptyDoc(p.kind, [...p.bounds] as [number, number, number]);
    doc.id = `new_${name.toLowerCase()}`;
    this.loadDoc(doc);
  }

  private loadModel(m: VoxelModel): void {
    this.loadDoc(docFromModel(m));
  }

  private loadDoc(doc: EditorDoc): void {
    this.doc = doc;
    this.activeClip = Object.keys(doc.animations)[0] ?? 'idle';
    this.activeFrame = 0;
    this.activeColor = 0;
    this.slice?.setDoc(doc);
    this.slice?.setActiveColor(0);
    this.preview?.setDoc(doc);
    this.syncFrame();
    this.buildVoxelSidebar();
  }

  private saveLibrary(): void {
    const model = modelFromDoc(this.doc);
    saveToLibrary(model);
    this.engine.animation.registerModel(model); // make it immediately placeable
    this.toast(`Saved "${model.id}" — now placeable in the World tab.`);
  }

  private exportJson(): void {
    const model = modelFromDoc(this.doc);
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.doc.id}.vxl.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast(`Exported ${this.doc.id}.vxl.json`);
  }

  private refreshCounts(): void {
    const node = this.sidebar.querySelector('#ed-counts');
    if (node) node.textContent = `${this.slice?.voxelCount() ?? 0} voxels · ${Object.keys(this.doc.frames).length} frames`;
  }

  // -- world tab ------------------------------------------------------------

  private buildWorldSidebar(): void {
    clear(this.sidebar);
    const block = el('div', { class: 'ed-block' });
    block.append(el('div', { class: 'ed-title', textContent: 'Place in World' }));
    block.append(el('div', { class: 'ed-help', html: 'Click anywhere on the ground to drop the selected model. Walk around first, then open the editor where you want to build.' } as never));

    const sel = el('select', { class: 'ed-in' }) as HTMLSelectElement;
    const lib = loadLibrary();
    if (lib.length) {
      const og = el('optgroup', { label: 'My creations' } as never) as HTMLOptGroupElement;
      for (const m of lib) og.append(el('option', { value: m.id, textContent: m.id }));
      sel.append(og);
    }
    const placeable = allModels.filter((m) => m.kind === 'prop' || m.kind === 'tile' || /^(tree|pine|house|flower|bush|rock|fence|sign|lamp|fountain)/.test(m.id));
    const og2 = el('optgroup', { label: 'Built-in' } as never) as HTMLOptGroupElement;
    for (const m of placeable) og2.append(el('option', { value: m.id, textContent: m.id }));
    sel.append(og2);
    if ([...lib, ...placeable].some((m) => m.id === this.placeModelId)) sel.value = this.placeModelId;
    else this.placeModelId = sel.value;
    sel.addEventListener('change', () => (this.placeModelId = sel.value));
    block.append(this.field('Model', sel));

    const solidWrap = el('label', { class: 'ed-check' });
    const solidIn = el('input', { type: 'checkbox' }) as HTMLInputElement;
    solidIn.checked = this.placeSolid;
    solidIn.addEventListener('change', () => (this.placeSolid = solidIn.checked));
    solidWrap.append(solidIn, el('span', { textContent: 'Solid (blocks the player)' }));
    block.append(solidWrap);

    const row = el('div', { class: 'ed-btn-row' });
    row.append(
      el('button', { class: 'ed-btn', textContent: 'Undo last placement', onclick: () => { if (this.engine.overworldScene.removeLastCustom()) this.toast('Removed last placed object.'); } } as never),
    );
    block.append(row);
    this.sidebar.append(block);
  }

  private enterWorldPlacement(): void {
    if (this.worldClickHandler) return;
    const canvas = this.engine.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      this.worldDown = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!this.worldDown) return;
      const moved = Math.hypot(e.clientX - this.worldDown.x, e.clientY - this.worldDown.y);
      this.worldDown = null;
      if (moved > 6) return;
      if (this.tab !== 'world') return;
      const gp = this.engine.groundPoint(e.clientX, e.clientY);
      if (!gp) return;
      const ok = this.engine.overworldScene.placeCustom(this.placeModelId, Math.round(gp.x), Math.round(gp.z), 0, this.placeSolid);
      if (ok) this.toast(`Placed ${this.placeModelId}.`);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    this.worldClickHandler = onUp;
    // store the down handler on the element via closure cleanup
    (this.worldClickHandler as unknown as { _down?: typeof onDown })._down = onDown;
  }

  private exitWorldPlacement(): void {
    if (!this.worldClickHandler) return;
    const canvas = this.engine.renderer.domElement;
    const down = (this.worldClickHandler as unknown as { _down?: (e: PointerEvent) => void })._down;
    if (down) canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointerup', this.worldClickHandler);
    this.worldClickHandler = null;
    this.worldDown = null;
  }

  // -- data tab -------------------------------------------------------------

  private dataRows: { items: Record<string, unknown>[]; enemies: Record<string, unknown>[] } | null = null;

  private buildDataSidebar(): void {
    clear(this.sidebar);
    if (!this.dataRows) {
      this.dataRows = {
        items: structuredClone(ITEMS) as unknown as Record<string, unknown>[],
        enemies: structuredClone(ENEMIES) as unknown as Record<string, unknown>[],
      };
    }
    this.sidebar.classList.add('wide');
    const block = el('div', { class: 'ed-block' });
    block.append(el('div', { class: 'ed-title', textContent: 'Game Data' }));
    block.append(el('div', { class: 'ed-help', html: 'Edit values, then download the JSON to commit into the project content files.' } as never));

    block.append(this.dataTable('Items', this.dataRows.items, ['id', 'name', 'category', 'price', 'hpHeal', 'ppHeal', 'offense', 'defense'], 'items.json'));
    block.append(this.dataTable('Enemies', this.dataRows.enemies, ['id', 'name', 'modelId', 'maxHp', 'offense', 'defense', 'speed', 'exp', 'money'], 'enemies.json'));
    this.sidebar.append(block);
  }

  private dataTable(title: string, rows: Record<string, unknown>[], cols: string[], file: string): HTMLElement {
    const wrap = el('div', { style: 'margin-bottom:16px' } as never);
    const head = el('div', { class: 'ed-btn-row' });
    head.append(
      el('div', { class: 'ed-sub', textContent: title, style: 'flex:1' } as never),
      el('button', { class: 'ed-btn', textContent: 'Download JSON', onclick: () => this.download(file, rows) } as never),
    );
    wrap.append(head);
    const table = el('table', { class: 'ed-table' });
    const thead = el('tr');
    for (const c of cols) thead.append(el('th', { textContent: c }));
    table.append(thead);
    for (const row of rows) {
      const tr = el('tr');
      for (const c of cols) {
        const td = el('td');
        const isNum = typeof row[c] === 'number';
        const inp = el('input', { class: 'ed-cell', value: row[c] === undefined ? '' : String(row[c]) }) as HTMLInputElement;
        inp.addEventListener('change', () => {
          row[c] = isNum ? Number(inp.value) : inp.value;
        });
        td.append(inp);
        tr.append(td);
      }
      table.append(tr);
    }
    wrap.append(table);
    return wrap;
  }

  private download(name: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast(`Exported ${name}`);
  }

  // -- helpers --------------------------------------------------------------

  private field(label: string, control: HTMLElement): HTMLElement {
    return el('div', { class: 'ed-field' }, [el('span', { textContent: label }), control]);
  }
}
