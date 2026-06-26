import * as THREE from 'three';
import { FONT_H, stampText, textWidth, wrapText } from './VoxelFont';
import { VoxelMesh } from './VoxelRenderer';

export const UI_COLORS = {
  panel: 0x12182a,
  panelLight: 0x1a2238,
  border: 0xf4f4ff,
  borderHi: 0xffffff,
  accent: 0xffd23a,
  accent2: 0xe8453c,
  text: 0xffffff,
  textDim: 0xa0a8c0,
  textGold: 0xffd23a,
  sel: 0x3a5080,
  selBorder: 0xffd23a,
  hp: 0x5ad05a,
  pp: 0x5aa0e8,
  good: 0x5ad05a,
  bad: 0xe8453c,
  shadow: 0x060810,
} as const;

type Voxel = { x: number; y: number; z: number; color: number };

/** 2D canvas that compiles to a thin slab of voxels (border extruded forward). */
export class VoxelCanvas {
  readonly w: number;
  readonly h: number;
  private cells = new Map<string, number>();

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  clear(): void {
    this.cells.clear();
  }

  set(x: number, y: number, color: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.cells.set(`${x},${y}`, color);
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
    }
  }

  /** EarthBound-style window: thick border + inset fill + drop shadow. */
  drawWindow(x: number, y: number, w: number, h: number, fill: number = UI_COLORS.panel): void {
    this.fillRect(x + 2, y + 2, w, h, UI_COLORS.shadow);
    this.fillRect(x, y, w, h, UI_COLORS.border);
    this.fillRect(x + 1, y + 1, w - 2, h - 2, fill);
    this.fillRect(x + 2, y + 2, w - 4, h - 4, UI_COLORS.panelLight);
    this.fillRect(x + 3, y + 3, w - 6, h - 6, fill);
  }

  drawText(text: string, x: number, y: number, color: number, scale = 1): void {
    stampText(text, x, y, scale, (px, py) => this.set(px, py, color));
  }

  drawTextWrapped(text: string, x: number, y: number, maxW: number, color: number, scale = 1, lineGap = 2): number {
    const lines = wrapText(text, maxW, scale);
    const lh = (FONT_H + lineGap) * scale;
    lines.forEach((line, i) => this.drawText(line, x, y + i * lh, color, scale));
    return lines.length * lh;
  }

  drawMenuItem(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    detail: string | undefined,
    selected: boolean,
    disabled: boolean,
  ): void {
    const fill = selected ? UI_COLORS.sel : UI_COLORS.panel;
    const border = selected ? UI_COLORS.selBorder : UI_COLORS.border;
    this.fillRect(x, y, w, h, border);
    this.fillRect(x + 1, y + 1, w - 2, h - 2, fill);
    const col = disabled ? UI_COLORS.textDim : UI_COLORS.text;
    this.drawText(label, x + 4, y + 3, col, 1);
    if (detail) {
      const dw = textWidth(detail, 1);
      this.drawText(detail, x + w - dw - 4, y + 3, UI_COLORS.textDim, 1);
    }
  }

  drawBar(x: number, y: number, w: number, h: number, pct: number, color: number): void {
    this.fillRect(x, y, w, h, 0x222838);
    const fw = Math.max(0, Math.min(w, Math.round(w * pct)));
    if (fw > 0) this.fillRect(x, y, fw, h, color);
  }

  blit(other: VoxelCanvas, ox: number, oy: number): void {
    for (const [key, color] of other.cells) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      this.set(ox + x, oy + y, color);
    }
  }

  /**
   * Compile the canvas to a chunky 3D voxel slab. Every cell is extruded `depth`
   * voxels deep; border cells get one extra so the frame stands proud of the
   * fill. The result is a solid object meant to live in the world, not a decal.
   */
  toVoxels(flipY = true, depth = 2): Voxel[] {
    const out: Voxel[] = [];
    const isBorder = (c: number) =>
      c === UI_COLORS.border || c === UI_COLORS.borderHi || c === UI_COLORS.selBorder;

    for (const [key, color] of this.cells) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const vy = flipY ? this.h - 1 - y : y;
      const d = isBorder(color) ? depth + 1 : depth;
      for (let z = 0; z < d; z++) out.push({ x, y: vy, z, color });
    }
    return out;
  }
}

export interface MenuItemSpec {
  label: string;
  detail?: string;
  disabled?: boolean;
}

/**
 * Renders all player-facing UI as a real voxel object inside the game world.
 *
 * The UI is a single chunky voxel slab parented to the game camera and stood
 * upright at the world's isometric pitch, so it is drawn by the same camera,
 * lit by the same scene lights, and viewed at the same angle as everything else
 * in the world. It is not a flat screen-space overlay — it is a physical part of
 * the scene that happens to track the camera so it stays readable.
 */
export class VoxelUIHost {
  /** Parented to the game camera in GameEngine; tilted upright each frame. */
  readonly group = new THREE.Group();
  private mesh = new VoxelMesh(0.04);
  private canvasH = 0;
  private scale = 1;

  constructor() {
    this.group.add(this.mesh.group);
    this.group.visible = false;
  }

  /** No screen-space projection any more; sizing is world-relative. */
  resize(_w: number, _h: number): void {
    /* intentionally empty */
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Height of the current slab in world units (used to park it in front of the camera). */
  get worldHeight(): number {
    return this.canvasH * this.scale;
  }

  /**
   * Replace the on-screen UI with a fresh voxel slab built from `canvas`. The
   * slab is centred on the group origin (which the engine places in front of the
   * camera) and scaled so each cell is `scale` world units — roughly the size of
   * a world voxel, so the chrome reads as part of the scene.
   */
  setCanvas(canvas: VoxelCanvas | null, scale: number): void {
    if (!canvas) {
      this.mesh.buildFromVoxels([]);
      this.group.visible = false;
      return;
    }
    this.canvasH = canvas.h;
    this.scale = scale;
    this.mesh.buildFromVoxels(canvas.toVoxels(true, 2));
    this.mesh.group.position.set(-(canvas.w * scale) / 2, -(canvas.h * scale) / 2, 0);
    this.mesh.group.scale.setScalar(scale);
    this.group.visible = true;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

/** Build a centered menu panel canvas. */
export function buildMenuCanvas(
  title: string,
  items: MenuItemSpec[],
  selected: number,
  footer?: string,
  panelW = 420,
): VoxelCanvas {
  const itemH = 14;
  const pad = 12;
  const titleH = 18;
  const footerH = footer ? 16 : 0;
  const h = pad + titleH + items.length * itemH + footerH + pad;
  const c = new VoxelCanvas(panelW, h);
  c.drawWindow(0, 0, panelW, h);
  c.drawText(title.toUpperCase(), pad, pad, UI_COLORS.accent, 1);
  items.forEach((it, i) => {
    c.drawMenuItem(pad, pad + titleH + i * itemH, panelW - pad * 2, itemH - 2, it.label, it.detail, i === selected, !!it.disabled);
  });
  if (footer) c.drawText(footer, pad, h - pad - FONT_H, UI_COLORS.textDim, 1);
  return c;
}

/** Build dialogue box canvas for world-attached UI. */
export function buildDialogueCanvas(
  speaker: string | undefined,
  text: string,
  choices: MenuItemSpec[] | undefined,
  selected: number,
  maxW = 640,
): VoxelCanvas {
  const pad = 10;
  const textScale = 1;
  const innerW = maxW - pad * 2 - 8;
  const textH = wrapText(text, innerW, textScale).length * (FONT_H + 2) * textScale;
  const speakerH = speaker ? 14 : 0;
  const choiceH = choices ? choices.length * 14 + 6 : 0;
  const hintH = choices ? 0 : 12;
  const h = pad + speakerH + textH + choiceH + hintH + pad;
  const c = new VoxelCanvas(maxW, Math.max(h, 48));
  c.drawWindow(0, 0, maxW, c.h);
  let y = pad;
  if (speaker) {
    c.fillRect(pad, y, speaker.length * 6 + 10, 12, UI_COLORS.accent2);
    c.drawText(speaker, pad + 4, y + 2, UI_COLORS.text, 1);
    y += speakerH;
  }
  c.drawTextWrapped(text, pad + 4, y + 2, innerW, UI_COLORS.text, textScale);
  y += textH + 4;
  if (choices) {
    choices.forEach((ch, i) => {
      c.drawMenuItem(pad, y, maxW - pad * 2, 12, ch.label, ch.detail, i === selected, !!ch.disabled);
      y += 14;
    });
  } else {
    c.drawText('Z continue', maxW - textWidth('Z continue', 1) - pad, c.h - pad - FONT_H, UI_COLORS.textDim, 1);
  }
  return c;
}

/** Compact HUD strip. Auto-sizes to fit both strings (clamped to maxW). */
export function buildHudCanvas(left: string, right: string, maxW = 720): VoxelCanvas {
  const h = 16;
  const lw = textWidth(left, 1);
  const rw = textWidth(right, 1);
  const w = Math.min(maxW, Math.max(120, lw + rw + 28));
  const c = new VoxelCanvas(w, h);
  c.drawWindow(0, 0, w, h, UI_COLORS.panel);
  c.drawText(left, 8, 4, UI_COLORS.textDim, 1);
  c.drawText(right, w - rw - 8, 4, UI_COLORS.textGold, 1);
  return c;
}

/** Quest tracker chip. */
export function buildQuestCanvas(title: string, objective: string): VoxelCanvas {
  const w = 240;
  const h = 32;
  const c = new VoxelCanvas(w, h);
  c.drawWindow(0, 0, w, h);
  c.drawText(title, 8, 4, UI_COLORS.accent, 1);
  c.drawTextWrapped(objective, 8, 16, w - 16, UI_COLORS.text, 1);
  return c;
}

/** Toast notification. */
export function buildToastCanvas(msg: string): VoxelCanvas {
  const w = Math.min(360, Math.max(120, textWidth(msg, 1) + 24));
  const h = 18;
  const c = new VoxelCanvas(w, h);
  c.drawWindow(0, 0, w, h);
  c.drawText(msg, 8, 4, UI_COLORS.text, 1);
  return c;
}

/** Title screen logo + menu (overlay). */
export function buildTitleCanvas(subtitle: string, items: MenuItemSpec[], selected: number, w = 480): VoxelCanvas {
  const logo = 'VOXELBOUND';
  const logoW = textWidth(logo, 2);
  const menu = buildMenuCanvas('', items, selected, undefined, w);
  const h = 72 + menu.h;
  const c = new VoxelCanvas(w, h);
  c.drawText(logo, Math.floor((w - logoW) / 2), 6, UI_COLORS.text, 2);
  c.drawText(subtitle, Math.floor((w - textWidth(subtitle, 1)) / 2), 34, UI_COLORS.textDim, 1);
  c.blit(menu, 0, 68);
  return c;
}

/** Battle log message bar. */
export function buildBattleLogCanvas(text: string, w = 680): VoxelCanvas {
  const h = 22;
  const c = new VoxelCanvas(w, h);
  c.drawWindow(0, 0, w, h);
  c.drawTextWrapped(text, 10, 4, w - 20, UI_COLORS.text, 1);
  return c;
}

/** Party member stat window. */
export function buildPartyWindowCanvas(
  name: string,
  level: number,
  hp: number,
  maxHp: number,
  pp: number,
  maxPp: number,
  active: boolean,
  downed: boolean,
  w = 148,
): VoxelCanvas {
  const h = 38;
  const c = new VoxelCanvas(w, h);
  c.drawWindow(0, 0, w, h, downed ? 0x101018 : UI_COLORS.panel);
  if (active) c.fillRect(0, 0, w, 2, UI_COLORS.accent);
  c.drawText(`${name} LV${level}`, 6, 4, downed ? UI_COLORS.textDim : UI_COLORS.text, 1);
  c.drawText(`HP ${hp}/${maxHp}`, 6, 16, UI_COLORS.textDim, 1);
  c.drawBar(6, 24, w - 12, 4, maxHp > 0 ? hp / maxHp : 0, UI_COLORS.hp);
  c.drawText(`PP ${pp}/${maxPp}`, w / 2 + 4, 16, UI_COLORS.textDim, 1);
  c.drawBar(w / 2 + 4, 24, w / 2 - 10, 4, maxPp > 0 ? pp / maxPp : 0, UI_COLORS.pp);
  return c;
}

/** Compose multiple canvases into one overlay layout. */
export function composeOverlay(
  parts: Array<{ canvas: VoxelCanvas; x: number; y: number }>,
  totalW: number,
  totalH: number,
): VoxelCanvas {
  const out = new VoxelCanvas(totalW, totalH);
  for (const p of parts) out.blit(p.canvas, p.x, p.y);
  return out;
}
