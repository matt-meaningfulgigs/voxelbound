import type { GameEngine } from '@voxelbound/engine';
import {
  buildBattleLogCanvas,
  buildDialogueCanvas,
  buildHudCanvas,
  buildMenuCanvas,
  buildPartyWindowCanvas,
  buildQuestCanvas,
  buildTitleCanvas,
  buildToastCanvas,
  VoxelCanvas,
  type MenuItemSpec,
} from '@voxelbound/engine';

export type { MenuItemSpec };

/**
 * World units per UI voxel cell. ~0.6 keeps each chunk close to the size of a
 * world voxel, so the chrome reads as part of the scene while still fitting the
 * existing panel layouts across the view.
 */
const WORLD_CELL = 0.6;

interface PartyMember {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  pp: number;
  maxPp: number;
  active: boolean;
  downed: boolean;
}

/**
 * Drives all player-facing UI. Every active layer (HUD, quest, toasts, dialogue,
 * menus, title, battle) is composed into a single voxel canvas which the engine
 * renders as a chunky slab standing inside the 3D world.
 */
export class VoxelGameUI {
  private engine: GameEngine;

  private hudLeft = '';
  private hudRight = '';
  private quest: { title: string; objective: string } | null = null;
  private toasts: string[] = [];
  private dialogue: {
    speaker?: string;
    text: string;
    choices?: MenuItemSpec[];
    selected: number;
  } | null = null;

  private menu: { title: string; items: MenuItemSpec[]; selected: number; footer?: string } | null = null;
  private title: { subtitle: string; items: MenuItemSpec[]; selected: number } | null = null;
  private battle: {
    log: string;
    party: PartyMember[];
    menuTitle: string;
    menuItems: MenuItemSpec[];
    menuSelected: number;
  } | null = null;

  /** When a full-screen mode (title/battle) is up, overworld chrome is hidden. */
  private suppressWorldLayers = false;

  constructor(engine: GameEngine) {
    this.engine = engine;
    window.addEventListener('resize', () => this.render());
  }

  /** Size of the visible frustum in UI cells (canvas fills the view before tilt). */
  private viewCells(): { cw: number; ch: number } {
    const viewH = this.engine.settings.camera.viewHeightVoxels * this.engine.settings.camera.zoom;
    const viewW = viewH * this.engine.aspect();
    return {
      cw: Math.max(80, Math.round(viewW / WORLD_CELL)),
      ch: Math.max(80, Math.round(viewH / WORLD_CELL)),
    };
  }

  hideAll(): void {
    this.hudLeft = '';
    this.hudRight = '';
    this.quest = null;
    this.toasts = [];
    this.dialogue = null;
    this.menu = null;
    this.title = null;
    this.battle = null;
    this.suppressWorldLayers = false;
    this.render();
  }

  // ---- overworld ------------------------------------------------------------

  setHud(left: string, right: string): void {
    this.hudLeft = left;
    this.hudRight = right;
    this.render();
  }

  setQuest(title: string, objective: string | null): void {
    this.quest = objective ? { title, objective } : null;
    this.render();
  }

  setDialogue(speaker: string | undefined, text: string, choices?: MenuItemSpec[], selected = 0): void {
    this.dialogue = { speaker, text, choices, selected };
    this.render();
  }

  clearDialogue(): void {
    this.dialogue = null;
    this.render();
  }

  toast(msg: string): void {
    this.toasts.push(msg);
    if (this.toasts.length > 6) this.toasts.shift();
    this.render();
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t !== msg);
      this.render();
    }, 3200);
  }

  // ---- overlay menus --------------------------------------------------------

  showMenu(title: string, items: MenuItemSpec[], selected: number, footer?: string): void {
    this.menu = { title, items, selected, footer };
    this.title = null;
    this.render();
  }

  hideMenu(): void {
    this.menu = null;
    this.render();
  }

  showTitle(subtitle: string, items: MenuItemSpec[], selected: number): void {
    this.title = { subtitle, items, selected };
    this.menu = null;
    this.suppressWorldLayers = true;
    this.render();
  }

  hideTitle(): void {
    this.title = null;
    this.suppressWorldLayers = false;
    this.render();
  }

  // ---- battle ---------------------------------------------------------------

  showBattle(
    logText: string,
    party: PartyMember[],
    menuTitle: string,
    menuItems: MenuItemSpec[],
    menuSelected: number,
  ): void {
    this.battle = { log: logText, party, menuTitle, menuItems, menuSelected };
    this.suppressWorldLayers = true;
    this.render();
  }

  hideBattle(): void {
    this.battle = null;
    this.suppressWorldLayers = false;
    this.render();
  }

  // ---- composition ----------------------------------------------------------

  private render(): void {
    const { cw, ch } = this.viewCells();
    const canvas = new VoxelCanvas(cw, ch);
    const margin = 6;
    let any = false;

    if (!this.suppressWorldLayers) {
      let topY = margin;
      if (this.hudLeft || this.hudRight) {
        const hud = buildHudCanvas(this.hudLeft, this.hudRight, cw - margin * 2);
        canvas.blit(hud, Math.floor((cw - hud.w) / 2), topY);
        topY += hud.h + 4;
        any = true;
      }
      if (this.quest) {
        canvas.blit(buildQuestCanvas(this.quest.title, this.quest.objective), margin, topY);
        any = true;
      }
      let ty = margin;
      this.toasts.slice(-4).forEach((msg) => {
        const t = buildToastCanvas(msg);
        canvas.blit(t, cw - t.w - margin, ty);
        ty += t.h + 4;
        any = true;
      });
      if (this.dialogue) {
        const d = buildDialogueCanvas(
          this.dialogue.speaker,
          this.dialogue.text,
          this.dialogue.choices,
          this.dialogue.selected,
          Math.min(cw - margin * 2, 280),
        );
        canvas.blit(d, Math.floor((cw - d.w) / 2), ch - d.h - margin);
        any = true;
      }
    }

    if (this.menu) {
      const m = buildMenuCanvas(
        this.menu.title,
        this.menu.items,
        this.menu.selected,
        this.menu.footer,
        Math.min(cw - margin * 2, 240),
      );
      canvas.blit(m, Math.floor((cw - m.w) / 2), Math.floor((ch - m.h) / 2));
      any = true;
    } else if (this.title) {
      const t = buildTitleCanvas(
        this.title.subtitle,
        this.title.items,
        this.title.selected,
        Math.min(cw - margin * 2, 240),
      );
      canvas.blit(t, Math.floor((cw - t.w) / 2), Math.floor((ch - t.h) / 2));
      any = true;
    } else if (this.battle) {
      this.composeBattle(canvas, cw, ch);
      any = true;
    }

    this.engine.voxelUI.setCanvas(any ? canvas : null, WORLD_CELL);
  }

  private composeBattle(canvas: VoxelCanvas, cw: number, ch: number): void {
    const b = this.battle!;
    const log = buildBattleLogCanvas(b.log, Math.min(cw - 24, 320));
    canvas.blit(log, Math.floor((cw - log.w) / 2), 10);

    const n = Math.max(1, b.party.length);
    const gap = 6;
    const pw = Math.min(148, Math.floor((cw - 20 - (n - 1) * gap) / n));
    const totalW = n * pw + (n - 1) * gap;
    let px = Math.floor((cw - totalW) / 2);
    const py = ch - 48;
    b.party.forEach((p) => {
      canvas.blit(
        buildPartyWindowCanvas(p.name, p.level, p.hp, p.maxHp, p.pp, p.maxPp, p.active, p.downed, pw),
        px,
        py,
      );
      px += pw + gap;
    });

    if (b.menuItems.length) {
      // Centre the command menu (like the log/party windows, which render
      // reliably) instead of right-anchoring it, which pushed it off-frame.
      const menuW = Math.min(200, cw - 24);
      const menu = buildMenuCanvas(b.menuTitle, b.menuItems, b.menuSelected, undefined, menuW);
      const mx = Math.floor((cw - menu.w) / 2);
      const my = Math.max(28, py - menu.h - 8);
      canvas.blit(menu, mx, my);
    }
  }
}
