import {
  DialogueRunner,
  SaveSystem,
  SAVE_SLOTS,
  GameState,
  type GameEngine,
  type ScriptHooks,
  type PartyMemberState,
} from '@voxelbound/engine';
import {
  ITEM_BY_ID,
  PSI_BY_ID,
  QUEST_BY_ID,
  QUESTS,
  SHOP_BY_ID,
  CHARACTER_BY_ID,
  type EquipSlot,
} from '@voxelbound/shared';
import { BattleUI, type BattleOutcome, type InputAction } from './Battle';
import { EditorOverlay } from '../editor/EditorOverlay';
import { VoxelGameUI, type MenuItemSpec } from '../ui/VoxelGameUI';

type Mode = 'title' | 'overworld' | 'dialogue' | 'menu' | 'shop' | 'battle' | 'gameover' | 'editor';

interface MItem {
  label: string;
  detail?: string;
  disabled?: boolean;
  onSelect?: () => void;
}
interface MScreen {
  title: string;
  items: () => MItem[];
  footer?: () => string;
  onCancel?: () => void;
}

/** A reusable navigable, stack-based menu rendered as voxel panels. */
class Nav {
  private stack: Array<{ screen: MScreen; index: number }> = [];
  constructor(
    private paint: (screen: MScreen, index: number) => void,
    private onEmpty: () => void,
  ) {}

  get depth(): number {
    return this.stack.length;
  }
  push(s: MScreen): void {
    this.stack.push({ screen: s, index: this.firstEnabled(s) });
    this.render();
  }
  reset(s: MScreen): void {
    this.stack = [];
    this.push(s);
  }
  closeAll(): void {
    this.stack = [];
    this.onEmpty();
  }
  private firstEnabled(s: MScreen): number {
    const items = s.items();
    const i = items.findIndex((it) => !it.disabled);
    return i < 0 ? 0 : i;
  }
  action(a: InputAction): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    const items = top.screen.items();
    if (items.length === 0) {
      if (a === 'cancel') this.pop();
      return;
    }
    if (a === 'up') {
      do {
        top.index = (top.index - 1 + items.length) % items.length;
      } while (items[top.index]?.disabled);
      this.render();
    } else if (a === 'down') {
      do {
        top.index = (top.index + 1) % items.length;
      } while (items[top.index]?.disabled);
      this.render();
    } else if (a === 'confirm') {
      const it = items[top.index];
      if (it && !it.disabled) {
        it.onSelect?.();
        if (this.stack.length) this.render();
      }
    } else if (a === 'cancel') {
      this.pop();
    }
  }
  private pop(): void {
    const top = this.stack[this.stack.length - 1];
    top?.screen.onCancel?.();
    this.stack.pop();
    if (this.stack.length === 0) this.onEmpty();
    else this.render();
  }
  render(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    const items = top.screen.items();
    if (top.index >= items.length) top.index = Math.max(0, items.length - 1);
    this.paint(top.screen, top.index);
  }
}

export class GameController {
  private engine: GameEngine;
  private mode: Mode = 'title';
  private inputLockUntil = 0;

  private voxelUI: VoxelGameUI;
  private dialogue: DialogueRunner;
  private battleUI!: BattleUI;
  private editor: EditorOverlay | null = null;
  private afterBattle: (() => void) | null = null;
  private afterShop: (() => void) | null = null;

  // dialogue state (text tracked for typewriter; voxel panel reads these)
  private dlgState: 'typing' | 'page' | 'choices' = 'page';
  private dlgFull = '';
  private dlgShown = 0;
  private dlgTimer: number | null = null;
  private dlgChoiceIdx = 0;
  private dlgSpeaker = '';
  private dlgChoices: MenuItemSpec[] = [];

  private titleNav!: Nav;
  private menuNav!: Nav;
  private shopNav!: Nav;
  private gameOverNav!: Nav;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.voxelUI = new VoxelGameUI(engine);
    this.dialogue = new DialogueRunner(this.engine.gs, this.makeHooks());
    this.battleUI = new BattleUI(this.engine, this.voxelUI);
    this.initNav();
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.wire();
    this.showTitle();
  }

  private screenToMenu(screen: MScreen, index: number): MenuItemSpec[] {
    return screen.items().map((it) => ({
      label: it.label.replace(/<[^>]+>/g, ''),
      detail: it.detail?.replace(/<[^>]+>/g, ''),
      disabled: it.disabled,
    }));
  }

  private initNav(): void {
    this.titleNav = new Nav(
      (screen, index) => {
        this.voxelUI.showTitle('v0.1 · A voxel EarthBound-like · Voxel Hollow', this.screenToMenu(screen, index), index);
      },
      () => {},
    );
    this.menuNav = new Nav(
      (screen, index) => {
        const footer = screen.footer?.()?.replace(/<[^>]+>/g, '');
        this.voxelUI.showMenu(screen.title, this.screenToMenu(screen, index), index, footer);
      },
      () => this.closeMenu(),
    );
    this.shopNav = new Nav(
      (screen, index) => {
        const footer = screen.footer?.()?.replace(/<[^>]+>/g, '');
        this.voxelUI.showMenu(screen.title, this.screenToMenu(screen, index), index, footer);
      },
      () => this.closeShop(),
    );
    this.gameOverNav = new Nav(
      (screen, index) => {
        const footer = screen.footer?.()?.replace(/<[^>]+>/g, '');
        this.voxelUI.showMenu(screen.title, this.screenToMenu(screen, index), index, footer);
      },
      () => {},
    );
  }

  // -- hooks for dialogue script actions -----------------------------------

  private makeHooks(): ScriptHooks {
    return {
      onBattle: (enc) => this.startBattle(enc, () => this.resumeDialogue()),
      onShop: (shop) => this.openShop(shop, () => this.resumeDialogue()),
      onWarp: (map, x, z) => {
        this.warp(map, x, z);
        this.resumeDialogue();
      },
      onJoin: (id) => this.toast(`${CHARACTER_BY_ID.get(id)?.name ?? 'Someone'} joined the party!`),
      onMoney: () => this.refreshHud(),
      onItem: (item, delta) => {
        const name = ITEM_BY_ID.get(item)?.name ?? item;
        this.toast(delta >= 0 ? `Got ${name}.` : `Lost ${name}.`);
        this.refreshHud();
      },
      onQuestChanged: (q) => {
        const def = QUEST_BY_ID.get(q);
        this.toast(def ? `Quest: ${def.title}` : 'Quest updated');
        this.refreshQuestTracker();
      },
    };
  }

  // -- mode + input ---------------------------------------------------------

  private setMode(m: Mode): void {
    this.mode = m;
    this.engine.paused = m !== 'overworld';
    this.inputLockUntil = performance.now() + 140;
    this.engine.input.endFrame();
    document.getElementById('settings-toggle')!.style.display = m === 'overworld' ? 'block' : 'none';
    if (m === 'overworld') this.refreshAll();
    else if (m !== 'editor' && m !== 'battle' && m !== 'dialogue') {
      // title/menu/shop/gameover paint via Nav; battle via BattleUI
    }
  }

  private codeToAction(code: string): InputAction | 'menu' | null {
    if (['ArrowUp', 'KeyW'].includes(code)) return 'up';
    if (['ArrowDown', 'KeyS'].includes(code)) return 'down';
    if (['ArrowLeft', 'KeyA'].includes(code)) return 'left';
    if (['ArrowRight', 'KeyD'].includes(code)) return 'right';
    if (['Enter', 'KeyZ', 'Space'].includes(code)) return 'confirm';
    if (['Escape', 'KeyX'].includes(code)) return 'cancel';
    if (['Tab', 'KeyM'].includes(code)) return 'menu';
    return null;
  }

  private onKey(e: KeyboardEvent): void {
    // global: toggle the in-game editor from the overworld
    if (e.code === 'Backquote' || e.code === 'F2') {
      if (this.mode === 'overworld') {
        e.preventDefault();
        this.openEditor();
        return;
      }
      if (this.mode === 'editor') {
        e.preventDefault();
        this.closeEditor();
        return;
      }
    }
    const action = this.codeToAction(e.code);
    if (!action) return;
    if (this.mode === 'overworld') return; // engine input system handles gameplay
    if (this.mode === 'editor') {
      if (action === 'cancel') {
        e.preventDefault();
        this.closeEditor();
      }
      return; // the editor handles its own mouse/button input
    }
    e.preventDefault();
    if (e.repeat && (action === 'confirm' || action === 'cancel')) return;
    if (performance.now() < this.inputLockUntil) return;

    const navAction: InputAction = action === 'menu' ? 'cancel' : action;
    switch (this.mode) {
      case 'title':
        this.titleNav.action(navAction);
        break;
      case 'dialogue':
        this.handleDialogueKey(action);
        break;
      case 'menu':
        this.menuNav.action(navAction);
        break;
      case 'shop':
        this.shopNav.action(navAction);
        break;
      case 'battle':
        if (action !== 'menu') this.battleUI.onAction(action);
        break;
      case 'gameover':
        this.gameOverNav.action(navAction);
        break;
    }
  }

  // -- title ----------------------------------------------------------------

  private showTitle(): void {
    this.setMode('title');
    this.titleNav.reset({
      title: 'VOXELBOUND',
      items: () => [
        { label: 'New Game', onSelect: () => this.newGame() },
        {
          label: 'Continue',
          disabled: !SaveSystem.hasAnySave(),
          onSelect: () => this.titleNav.push(this.loadScreen()),
        },
      ],
    });
  }

  private newGame(): void {
    this.engine.gs.data = GameState.newGame();
    this.engine.gs.data.playerX = 256;
    this.engine.gs.data.playerZ = 386;
    this.titleNav.closeAll();
    this.voxelUI.hideTitle();
    this.engine.goToMap('overworld', 256, 386);
    this.setMode('overworld');
    this.refreshAll();
    this.toast('Find Mara by the fountain. Press Z to talk, TAB for menu.');
  }

  // -- dialogue -------------------------------------------------------------

  private paintDialogue(): void {
    const shown = this.dlgFull.slice(0, this.dlgShown);
    if (this.dlgState === 'choices') {
      this.voxelUI.setDialogue(
        this.dlgSpeaker || undefined,
        shown,
        this.dlgChoices,
        this.dlgChoiceIdx,
      );
    } else {
      this.voxelUI.setDialogue(this.dlgSpeaker || undefined, shown);
    }
  }

  private startDialogue(scriptId: string): void {
    if (this.mode !== 'overworld') return;
    this.setMode('dialogue');
    if (!this.dialogue.start(scriptId, () => this.endDialogue())) {
      this.endDialogue();
      return;
    }
    this.refreshDialogue();
  }

  private resumeDialogue(): void {
    this.dialogue.resume();
    if (!this.dialogue.active) {
      this.endDialogue();
      return;
    }
    this.setMode('dialogue');
    this.refreshDialogue();
  }

  private refreshDialogue(): void {
    const v = this.dialogue.view();
    if (v.mode === 'done') {
      this.endDialogue();
      return;
    }
    if (v.mode === 'suspended') {
      this.voxelUI.clearDialogue();
      return;
    }
    this.dlgSpeaker = v.speaker ?? '';
    if (v.mode === 'text') {
      this.dlgChoices = [];
      this.startTyping(v.text);
    } else if (v.mode === 'choices') {
      this.dlgState = 'choices';
      this.dlgChoiceIdx = 0;
      this.dlgFull = '';
      this.dlgShown = 0;
      this.dlgChoices = v.choices.map((c) => ({ label: c.label }));
      this.paintDialogue();
    }
  }

  private startTyping(text: string): void {
    this.dlgState = 'typing';
    this.dlgFull = text;
    this.dlgShown = 0;
    if (this.dlgTimer) clearInterval(this.dlgTimer);
    this.paintDialogue();
    this.dlgTimer = window.setInterval(() => {
      this.dlgShown++;
      this.paintDialogue();
      if (this.dlgShown >= this.dlgFull.length) this.finishTyping();
    }, 18);
  }

  private finishTyping(): void {
    if (this.dlgTimer) clearInterval(this.dlgTimer);
    this.dlgTimer = null;
    this.dlgShown = this.dlgFull.length;
    this.dlgState = 'page';
    this.paintDialogue();
  }

  private handleDialogueKey(action: InputAction | 'menu'): void {
    if (this.dlgState === 'typing') {
      if (action === 'confirm') this.finishTyping();
      return;
    }
    if (this.dlgState === 'page') {
      if (action === 'confirm') {
        this.dialogue.advance();
        this.refreshDialogue();
      }
      return;
    }
    const v = this.dialogue.view();
    if (action === 'up') {
      this.dlgChoiceIdx = (this.dlgChoiceIdx - 1 + v.choices.length) % v.choices.length;
      this.paintDialogue();
    } else if (action === 'down') {
      this.dlgChoiceIdx = (this.dlgChoiceIdx + 1) % v.choices.length;
      this.paintDialogue();
    } else if (action === 'confirm') {
      this.commitChoice(v.choices);
    }
  }

  private commitChoice(choices: Array<{ label: string; index: number }>): void {
    const choice = choices[this.dlgChoiceIdx];
    if (!choice) return;
    this.dialogue.choose(choice.index);
    this.refreshDialogue();
  }

  private endDialogue(): void {
    if (this.dlgTimer) clearInterval(this.dlgTimer);
    this.dlgTimer = null;
    this.voxelUI.clearDialogue();
    this.engine.bus.emit('dialogue:end');
    this.refreshAll();
    if (this.mode === 'dialogue') this.setMode('overworld');
  }

  // -- battle ---------------------------------------------------------------

  private startBattle(encounterId: string, after: () => void): void {
    this.afterBattle = after;
    this.setMode('battle');
    this.voxelUI.clearDialogue();
    const intro = this.engine.goToBattle(encounterId);
    this.battleUI.start(intro, (o) => this.onBattleEnd(o));
  }

  private onBattleEnd(outcome: BattleOutcome): void {
    this.engine.returnToOverworld();
    if (outcome === 'defeat') {
      this.afterBattle = null;
      this.gameOver();
      return;
    }
    const cb = this.afterBattle;
    this.afterBattle = null;
    if (cb) cb();
    else this.setMode('overworld');
    this.refreshAll();
  }

  // -- shop -----------------------------------------------------------------

  private openShop(shopId: string, after: () => void): void {
    const shop = SHOP_BY_ID.get(shopId);
    if (!shop) {
      after();
      return;
    }
    this.afterShop = after;
    this.setMode('shop');
    this.voxelUI.clearDialogue();
    this.shopNav.reset({
      title: shop.name,
      footer: () => `Wallet: <span class="gold">${this.engine.gs.money}$</span>`,
      items: () => [
        { label: 'Buy', onSelect: () => this.shopNav.push(this.buyScreen(shopId)) },
        { label: 'Sell', onSelect: () => this.shopNav.push(this.sellScreen()) },
      ],
    });
  }

  private buyScreen(shopId: string): MScreen {
    const shop = SHOP_BY_ID.get(shopId)!;
    return {
      title: 'Buy',
      footer: () => `Wallet: <span class="gold">${this.engine.gs.money}$</span>`,
      items: () =>
        shop.items.map((id) => {
          const d = ITEM_BY_ID.get(id)!;
          return {
            label: d.name,
            detail: `${d.price}$`,
            disabled: this.engine.gs.money < d.price,
            onSelect: () => {
              this.engine.gs.addMoney(-d.price);
              this.engine.gs.giveItem(id);
              this.toast(`Bought ${d.name}.`);
              this.refreshHud();
            },
          };
        }),
    };
  }

  private sellScreen(): MScreen {
    return {
      title: 'Sell',
      footer: () => `Wallet: <span class="gold">${this.engine.gs.money}$</span>`,
      items: () =>
        this.engine.gs.data.inventory
          .filter((e) => {
            const d = ITEM_BY_ID.get(e.item);
            return d && d.category !== 'key';
          })
          .map((e) => {
            const d = ITEM_BY_ID.get(e.item)!;
            const price = Math.floor(d.price / 2);
            return {
              label: `${d.name}`,
              detail: `x${e.qty} · ${price}$`,
              onSelect: () => {
                this.engine.gs.takeItem(e.item, 1);
                this.engine.gs.addMoney(price);
                this.toast(`Sold ${d.name} for ${price}$.`);
                this.refreshHud();
              },
            };
          }),
    };
  }

  private closeShop(): void {
    this.voxelUI.hideMenu();
    const cb = this.afterShop;
    this.afterShop = null;
    if (cb) cb();
    else this.setMode('overworld');
  }

  // -- pause menu -----------------------------------------------------------

  private openPauseMenu(): void {
    if (this.mode !== 'overworld') return;
    this.setMode('menu');
    this.menuNav.reset(this.rootMenu());
  }

  private rootMenu(): MScreen {
    return {
      title: 'Menu',
      footer: () => `<span class="gold">${this.engine.gs.money}$</span>`,
      items: () => [
        { label: 'Status', onSelect: () => this.menuNav.push(this.statusScreen()) },
        { label: 'Goods', onSelect: () => this.menuNav.push(this.goodsScreen()) },
        { label: 'Equip', onSelect: () => this.menuNav.push(this.equipCharScreen()) },
        { label: 'PSI', onSelect: () => this.menuNav.push(this.psiCharScreen()) },
        { label: 'Quests', onSelect: () => this.menuNav.push(this.questScreen()) },
        { label: 'Editor', detail: '~', onSelect: () => { this.menuNav.closeAll(); this.openEditor(); } },
        { label: 'Save', onSelect: () => this.menuNav.push(this.saveScreen()) },
        { label: 'Options', onSelect: () => this.toggleSettings() },
        { label: 'Close', onSelect: () => this.menuNav.closeAll() },
      ],
    };
  }

  private statusScreen(): MScreen {
    return {
      title: 'Status',
      items: () =>
        this.engine.gs.party.map((p) => ({
          label: `${p.name} LV${p.level}`,
          onSelect: () => this.menuNav.push(this.statusDetail(p)),
        })),
    };
  }

  private statusDetail(p: PartyMemberState): MScreen {
    const off = this.engine.gs.effectiveOffense(p);
    const def = this.engine.gs.effectiveDefense(p);
    const nextExp = 8 * p.level * (p.level + 1);
    return {
      title: `${p.name}  LV ${p.level}`,
      items: () => [
        { label: 'HP', detail: `${p.hp} / ${p.maxHp}` },
        { label: 'PP', detail: `${p.pp} / ${p.maxPp}` },
        { label: 'OFFENSE', detail: `${off}` },
        { label: 'DEFENSE', detail: `${def}` },
        { label: 'SPEED', detail: `${p.speed}` },
        { label: 'GUTS', detail: `${p.guts}` },
        { label: 'IQ', detail: `${p.iq}` },
        { label: 'LUCK', detail: `${p.luck}` },
        { label: 'EXP', detail: `${p.exp} (next ${nextExp})` },
      ],
    };
  }

  private goodsScreen(): MScreen {
    return {
      title: 'Goods',
      items: () => {
        const inv = this.engine.gs.data.inventory;
        if (inv.length === 0) return [{ label: '(empty)', disabled: true }];
        return inv.map((e) => {
          const d = ITEM_BY_ID.get(e.item)!;
          return {
            label: d.name,
            detail: `x${e.qty}`,
            onSelect: () => this.menuNav.push(this.itemActionScreen(e.item)),
          };
        });
      },
    };
  }

  private itemActionScreen(itemId: string): MScreen {
    const d = ITEM_BY_ID.get(itemId)!;
    return {
      title: d.name,
      footer: () => d.desc,
      items: () => {
        const items: MItem[] = [];
        if (d.overworldUsable) items.push({ label: 'Use', onSelect: () => this.menuNav.push(this.useItemTarget(itemId)) });
        if (d.equipSlot) items.push({ label: 'Equip', onSelect: () => this.menuNav.push(this.equipItemTarget(itemId)) });
        if (d.category !== 'key') items.push({ label: 'Trash', onSelect: () => { this.engine.gs.takeItem(itemId, 1); this.toast(`Threw away ${d.name}.`); this.menuNav.action('cancel'); } });
        if (items.length === 0) items.push({ label: '(no actions)', disabled: true });
        return items;
      },
    };
  }

  private useItemTarget(itemId: string): MScreen {
    const d = ITEM_BY_ID.get(itemId)!;
    return {
      title: `Use ${d.name} on…`,
      items: () =>
        this.engine.gs.party.map((p, idx) => ({
          label: `${p.name}`,
          detail: p.downed ? 'DOWN' : `${p.hp}/${p.maxHp}`,
          onSelect: () => {
            this.applyOverworldItem(itemId, idx);
            this.menuNav.action('cancel');
          },
        })),
    };
  }

  private applyOverworldItem(itemId: string, partyIdx: number): void {
    const d = ITEM_BY_ID.get(itemId)!;
    const p = this.engine.gs.party[partyIdx]!;
    if (d.revive && p.downed) {
      p.downed = false;
      p.hp = d.hpHeal ?? Math.round(p.maxHp / 2);
      this.engine.gs.takeItem(itemId, 1);
      this.toast(`${p.name} revived!`);
      return;
    }
    if (p.downed) {
      this.toast(`${p.name} is unconscious.`);
      return;
    }
    if (d.hpHeal) p.hp = Math.min(p.maxHp, p.hp + d.hpHeal);
    if (d.ppHeal) p.pp = Math.min(p.maxPp, p.pp + d.ppHeal);
    this.engine.gs.takeItem(itemId, 1);
    this.toast(`${p.name} used ${d.name}.`);
  }

  private equipCharScreen(): MScreen {
    return {
      title: 'Equip — who?',
      items: () => this.engine.gs.party.map((p) => ({ label: p.name, onSelect: () => this.menuNav.push(this.equipSlotScreen(p)) })),
    };
  }

  private equipSlotScreen(p: PartyMemberState): MScreen {
    const slots: EquipSlot[] = ['weapon', 'body', 'arms', 'other'];
    return {
      title: `${p.name} — equipment`,
      items: () =>
        slots.map((slot) => {
          const cur = p.equip[slot];
          return {
            label: slot.toUpperCase(),
            detail: cur ? ITEM_BY_ID.get(cur)?.name ?? cur : '— none —',
            onSelect: () => this.menuNav.push(this.equipPickScreen(p, slot)),
          };
        }),
    };
  }

  private equipPickScreen(p: PartyMemberState, slot: EquipSlot): MScreen {
    return {
      title: `${slot.toUpperCase()} for ${p.name}`,
      items: () => {
        const cur = p.equip[slot];
        const curDef = cur ? ITEM_BY_ID.get(cur) : null;
        const opts: MItem[] = [{ label: '— Unequip —', disabled: !cur, onSelect: () => { delete p.equip[slot]; this.menuNav.action('cancel'); } }];
        for (const e of this.engine.gs.data.inventory) {
          const d = ITEM_BY_ID.get(e.item);
          if (!d || d.equipSlot !== slot) continue;
          const offD = (d.offense ?? 0) - (curDef?.offense ?? 0);
          const defD = (d.defense ?? 0) - (curDef?.defense ?? 0);
          opts.push({
            label: d.name,
            detail: this.deltaStr('OFF', offD) + ' ' + this.deltaStr('DEF', defD),
            onSelect: () => {
              p.equip[slot] = e.item;
              this.toast(`${p.name} equipped ${d.name}.`);
              this.menuNav.action('cancel');
            },
          });
        }
        return opts;
      },
    };
  }

  private deltaStr(label: string, d: number): string {
    if (d === 0) return `<span class="muted">${label} —</span>`;
    const arrow = d > 0 ? '▲' : '▼';
    const color = d > 0 ? 'var(--good)' : 'var(--bad)';
    return `<span style="color:${color}">${label} ${arrow}${Math.abs(d)}</span>`;
  }

  private equipItemTarget(itemId: string): MScreen {
    const d = ITEM_BY_ID.get(itemId)!;
    const slot = d.equipSlot!;
    return {
      title: `Equip ${d.name} on…`,
      items: () =>
        this.engine.gs.party.map((p) => ({
          label: p.name,
          onSelect: () => {
            p.equip[slot] = itemId;
            this.toast(`${p.name} equipped ${d.name}.`);
            this.menuNav.action('cancel');
          },
        })),
    };
  }

  private psiCharScreen(): MScreen {
    return {
      title: 'PSI — who?',
      items: () => this.engine.gs.party.map((p) => ({ label: p.name, onSelect: () => this.menuNav.push(this.psiListScreen(p)) })),
    };
  }

  private psiListScreen(p: PartyMemberState): MScreen {
    return {
      title: `${p.name} — PSI`,
      items: () => {
        if (p.psi.length === 0) return [{ label: '(no PSI learned)', disabled: true }];
        return p.psi.map((id) => {
          const d = PSI_BY_ID.get(id)!;
          return { label: d.name, detail: `${d.ppCost} PP` };
        });
      },
    };
  }

  private questScreen(): MScreen {
    return {
      title: 'Quests',
      items: () => {
        const out: MItem[] = [];
        for (const q of QUESTS) {
          const stage = this.engine.gs.questStage(q.id);
          if (stage < 0) continue;
          const done = stage >= q.stages.length;
          const obj = done ? 'Complete!' : q.stages[stage]?.objective ?? '';
          out.push({ label: `${done ? '✓ ' : ''}${q.title}`, detail: '' });
          out.push({ label: `<span class="muted">→ ${obj}</span>`, disabled: true });
        }
        if (out.length === 0) return [{ label: '(no quests yet)', disabled: true }];
        return out;
      },
    };
  }

  private saveScreen(): MScreen {
    return {
      title: 'Save Game',
      items: () =>
        Array.from({ length: SAVE_SLOTS }, (_, slot) => {
          const meta = SaveSystem.meta(slot);
          return {
            label: `Slot ${slot + 1}`,
            detail: meta ? `${meta.leaderName} LV${meta.level} · ${meta.mapName}` : '— empty —',
            onSelect: () => {
              SaveSystem.save(slot, this.engine.gs.data, this.locationName());
              this.toast(`Saved to slot ${slot + 1}.`);
              this.menuNav.render();
            },
          };
        }),
    };
  }

  private closeMenu(): void {
    this.voxelUI.hideMenu();
    this.setMode('overworld');
    this.refreshAll();
  }

  // -- load (from title) ----------------------------------------------------

  private loadScreen(): MScreen {
    return {
      title: 'Continue',
      items: () =>
        Array.from({ length: SAVE_SLOTS }, (_, slot) => {
          const meta = SaveSystem.meta(slot);
          return {
            label: `Slot ${slot + 1}`,
            detail: meta ? `${meta.leaderName} LV${meta.level} · ${meta.mapName}` : '— empty —',
            disabled: !meta,
            onSelect: () => this.loadGame(slot),
          };
        }),
    };
  }

  private loadGame(slot: number): void {
    const data = SaveSystem.load(slot);
    if (!data) {
      this.toast('No save in that slot.');
      return;
    }
    this.engine.gs.data = data;
    this.titleNav.closeAll();
    this.voxelUI.hideTitle();
    this.engine.goToMap(data.map, data.playerX, data.playerZ);
    this.setMode('overworld');
    this.refreshAll();
    this.toast('Game loaded.');
  }

  // -- game over ------------------------------------------------------------

  private gameOver(): void {
    this.setMode('gameover');
    this.gameOverNav.reset({
      title: 'GAME OVER',
      footer: () => 'Your party was defeated…',
      items: () => [
        {
          label: SaveSystem.hasAnySave() ? 'Load last save' : 'Return to Title',
          onSelect: () => {
            this.voxelUI.hideMenu();
            const latest = this.latestSlot();
            if (latest >= 0) this.loadGame(latest);
            else this.showTitle();
          },
        },
        {
          label: 'Revive at home (lose half $)',
          onSelect: () => {
            this.voxelUI.hideMenu();
            this.engine.gs.healParty();
            this.engine.gs.addMoney(-Math.floor(this.engine.gs.money / 2));
            this.engine.goToMap('overworld', 256, 386);
            this.setMode('overworld');
            this.refreshAll();
          },
        },
      ],
    });
  }

  private latestSlot(): number {
    let best = -1;
    let bestTime = -1;
    for (let s = 0; s < SAVE_SLOTS; s++) {
      const m = SaveSystem.meta(s);
      if (m && m.savedAt > bestTime) {
        bestTime = m.savedAt;
        best = s;
      }
    }
    return best;
  }

  // -- HUD / misc -----------------------------------------------------------

  wire(): void {
    this.engine.bus.on<{ dialogue: string }>('npc:talk', (p) => this.startDialogue(p.dialogue));
    this.engine.bus.on<{ toMap: string; toX: number; toZ: number }>('door:enter', (p) => this.warp(p.toMap, p.toX, p.toZ));
    this.engine.bus.on<{ encounterId: string }>('encounter', (p) => this.startBattle(p.encounterId, () => this.setMode('overworld')));
    this.engine.bus.on('menu:open', () => this.openPauseMenu());
  }

  private warp(map: string, x: number, z: number): void {
    this.engine.goToMap(map, x, z);
    this.refreshAll();
  }

  private toggleSettings(): void {
    document.getElementById('settings-panel')!.classList.toggle('open');
  }

  // -- in-game editor -------------------------------------------------------

  private openEditor(): void {
    if (this.mode !== 'overworld') return;
    if (!this.editor) {
      this.editor = new EditorOverlay(this.engine, {
        onClose: () => this.closeEditor(),
        toast: (m) => this.toast(m),
      });
    }
    this.voxelUI.hideAll();
    this.setMode('editor');
    this.editor.show();
  }

  private closeEditor(): void {
    this.editor?.hide();
    this.setMode('overworld');
    this.refreshAll();
  }

  toast(msg: string): void {
    this.voxelUI.toast(msg);
  }

  private locationName(): string {
    const m = this.engine.gs.data.map;
    if (m === 'overworld') return 'Voxel Hollow';
    return m.replace('_interior', '').replace(/_/g, ' ');
  }

  private activeQuestId(): string | null {
    for (const q of QUESTS) {
      const s = this.engine.gs.questStage(q.id);
      if (s >= 0 && s < q.stages.length) return q.id;
    }
    return null;
  }

  private refreshAll(): void {
    this.refreshHud();
    this.refreshQuestTracker();
  }

  private refreshHud(): void {
    this.voxelUI.setHud(
      'WASD move · Z talk · TAB menu · ~ editor',
      `${this.engine.gs.money}$ · ${this.locationName()}`,
    );
  }

  private refreshQuestTracker(): void {
    const qid = this.activeQuestId();
    if (!qid || this.mode !== 'overworld') {
      this.voxelUI.setQuest('', null);
      return;
    }
    const q = QUEST_BY_ID.get(qid)!;
    const stage = this.engine.gs.questStage(qid);
    this.voxelUI.setQuest(q.title, q.stages[stage]?.objective ?? '');
  }
}
