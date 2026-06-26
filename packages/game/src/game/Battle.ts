import type { GameEngine, BattleCommand, BattleEvent } from '@voxelbound/engine';
import { ITEM_BY_ID, PSI_BY_ID } from '@voxelbound/shared';
import { sleep } from './dom';
import type { VoxelGameUI, MenuItemSpec } from '../ui/VoxelGameUI';

export type BattleOutcome = 'victory' | 'defeat' | 'ran';
export type InputAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel';

interface SelectItem {
  label: string;
  detail?: string;
  disabled?: boolean;
}

interface ActiveSelect {
  index: number;
  count: number;
  resolve: (i: number) => void;
  cancelable: boolean;
  render: () => void;
}

/** Drives a full first-person battle with voxel UI panels. */
export class BattleUI {
  private engine: GameEngine;
  private voxelUI: VoxelGameUI;
  private logText = '';
  private menuTitle = '';
  private menuItems: MenuItemSpec[] = [];
  private menuSelected = 0;
  private active: ActiveSelect | null = null;
  private dispHp: number[] = [];
  private dispPp: number[] = [];
  private activePartyIdx = -1;
  private onEnd: (o: BattleOutcome) => void = () => {};

  constructor(engine: GameEngine, voxelUI: VoxelGameUI) {
    this.engine = engine;
    this.voxelUI = voxelUI;
  }

  start(introEvents: BattleEvent[], onEnd: (o: BattleOutcome) => void): void {
    this.onEnd = onEnd;
    const party = this.engine.gs.party;
    this.dispHp = party.map((p) => p.hp);
    this.dispPp = party.map((p) => p.pp);
    this.logText = '';
    this.menuTitle = '';
    this.menuItems = [];
    this.paint();
    void this.run(introEvents);
  }

  onAction(action: InputAction): void {
    const a = this.active;
    if (!a) return;
    if (action === 'up') {
      a.index = (a.index - 1 + a.count) % a.count;
      a.render();
    } else if (action === 'down') {
      a.index = (a.index + 1) % a.count;
      a.render();
    } else if (action === 'confirm') {
      const r = a.resolve;
      this.active = null;
      r(a.index);
    } else if (action === 'cancel' && a.cancelable) {
      const r = a.resolve;
      this.active = null;
      r(-1);
    }
  }

  private paint(): void {
    const party = this.engine.gs.party.map((p, i) => ({
      name: p.name,
      level: p.level,
      hp: Math.max(0, this.dispHp[i] ?? p.hp),
      maxHp: p.maxHp,
      pp: Math.max(0, this.dispPp[i] ?? p.pp),
      maxPp: p.maxPp,
      active: i === this.activePartyIdx,
      downed: p.downed,
    }));
    this.voxelUI.showBattle(
      this.logText,
      party,
      this.menuTitle,
      this.menuItems,
      this.menuSelected,
    );
  }

  // -- main loop ------------------------------------------------------------

  private async run(intro: BattleEvent[]): Promise<void> {
    await this.playEvents(intro);
    const battle = this.engine.battle;
    while (battle.outcome === 'ongoing') {
      const commands = await this.commandPhase();
      const events = battle.resolveRound(commands);
      await this.playEvents(events);
      this.paint();
    }
    if (battle.outcome === 'victory') await this.victory();
    else if (battle.outcome === 'ran') await this.message('You fled the battle.');
    this.finish(battle.outcome);
  }

  private finish(outcome: BattleOutcome): void {
    this.voxelUI.hideBattle();
    this.onEnd(outcome);
  }

  private async commandPhase(): Promise<BattleCommand[]> {
    const battle = this.engine.battle;
    const conscious = battle.consciousParty();
    const commands: BattleCommand[] = [];
    let i = 0;
    while (i < conscious.length) {
      const pIndex = conscious[i]!;
      this.activePartyIdx = pIndex;
      this.paint();
      const cmd = await this.chooseCommand(pIndex);
      if (cmd === 'back') {
        if (i > 0) {
          i -= 1;
          commands.pop();
        }
        continue;
      }
      commands.push(cmd);
      i += 1;
    }
    this.activePartyIdx = -1;
    this.menuTitle = '';
    this.menuItems = [];
    this.paint();
    return commands;
  }

  private async chooseCommand(pIndex: number): Promise<BattleCommand | 'back'> {
    const p = this.engine.gs.party[pIndex]!;
    for (;;) {
      const choice = await this.select(
        `${p.name}'s move`,
        [
          { label: 'Bash' },
          { label: 'PSI', disabled: p.psi.length === 0 },
          { label: 'Goods', disabled: this.battleItems().length === 0 },
          { label: 'Defend' },
          { label: 'Run' },
          { label: 'Auto' },
        ],
        true,
      );
      if (choice === -1) return 'back';
      const battle = this.engine.battle;
      if (choice === 0 || choice === 5) {
        const target = choice === 5 ? battle.livingEnemies()[0]! : await this.chooseEnemy();
        if (target === -1) continue;
        return { kind: 'bash', actor: pIndex, target };
      }
      if (choice === 1) {
        const psiId = await this.choosePsi(p.psi, p.pp);
        if (psiId === null) continue;
        const def = PSI_BY_ID.get(psiId)!;
        let target = 0;
        if (def.target === 'enemy') {
          target = await this.chooseEnemy();
          if (target === -1) continue;
        } else if (def.target === 'ally') {
          target = await this.chooseAlly();
          if (target === -1) continue;
        } else if (def.target === 'self') {
          target = pIndex;
        }
        return { kind: 'psi', actor: pIndex, psi: psiId, target };
      }
      if (choice === 2) {
        const itemId = await this.chooseItem();
        if (itemId === null) continue;
        const target = await this.chooseAlly();
        if (target === -1) continue;
        return { kind: 'item', actor: pIndex, item: itemId, target: { side: 'party', index: target } };
      }
      if (choice === 3) return { kind: 'defend', actor: pIndex };
      if (choice === 4) return { kind: 'run', actor: pIndex };
    }
  }

  private battleItems(): string[] {
    return this.engine.gs.data.inventory
      .filter((e) => {
        const d = ITEM_BY_ID.get(e.item);
        return d && d.battleUsable && e.qty > 0;
      })
      .map((e) => e.item);
  }

  private async chooseEnemy(): Promise<number> {
    const living = this.engine.battle.livingEnemies();
    const items: SelectItem[] = living.map((i) => ({ label: this.engine.battle.enemies[i]!.name }));
    const pick = await this.select('Target', items, true);
    return pick === -1 ? -1 : living[pick]!;
  }

  private async chooseAlly(): Promise<number> {
    const party = this.engine.gs.party;
    const items: SelectItem[] = party.map((p) => ({ label: p.name, detail: p.downed ? 'DOWN' : `${p.hp}/${p.maxHp}` }));
    return this.select('To whom?', items, true);
  }

  private async choosePsi(psi: string[], pp: number): Promise<string | null> {
    const items: SelectItem[] = psi.map((id) => {
      const d = PSI_BY_ID.get(id)!;
      return { label: d.name, detail: `${d.ppCost} PP`, disabled: d.ppCost > pp };
    });
    const pick = await this.select('PSI', items, true);
    return pick === -1 ? null : psi[pick]!;
  }

  private async chooseItem(): Promise<string | null> {
    const items = this.battleItems();
    const sel: SelectItem[] = items.map((id) => {
      const d = ITEM_BY_ID.get(id)!;
      return { label: d.name, detail: `x${this.engine.gs.itemCount(id)}` };
    });
    const pick = await this.select('Goods', sel, true);
    return pick === -1 ? null : items[pick]!;
  }

  // -- event playback -------------------------------------------------------

  private async playEvents(events: BattleEvent[]): Promise<void> {
    for (const ev of events) {
      switch (ev.kind) {
        case 'message':
          await this.message(ev.text);
          break;
        case 'enemyDamage':
          if (ev.smaaash) this.engine.battleScene.smaaash();
          else this.engine.battleScene.hitEnemy(ev.index);
          await sleep(160);
          break;
        case 'enemyDown':
          this.engine.battleScene.killEnemy(ev.index);
          await sleep(120);
          break;
        case 'partyDamage':
          this.engine.battleScene.flashScreen(0xff4040);
          await this.rollHp(ev.index);
          break;
        case 'partyHeal':
          await this.rollHp(ev.index);
          break;
        case 'partyPp':
          await this.rollPp(ev.index);
          break;
        case 'partyRevive':
          await this.message(`${ev.name} came back!`);
          break;
        case 'partyDown':
          await this.message(`${ev.name} is unconscious!`);
          break;
        case 'ranAway':
          await sleep(120);
          break;
        case 'enemyAppear':
          break;
      }
    }
  }

  private async rollHp(index: number): Promise<void> {
    const target = this.engine.gs.party[index]!.hp;
    await this.rollDisp(this.dispHp, index, target);
  }
  private async rollPp(index: number): Promise<void> {
    const target = this.engine.gs.party[index]!.pp;
    await this.rollDisp(this.dispPp, index, target);
  }
  private async rollDisp(arr: number[], index: number, target: number): Promise<void> {
    const start = arr[index] ?? target;
    const dir = Math.sign(target - start);
    if (dir === 0) return;
    const steps = Math.min(Math.abs(target - start), 40);
    const inc = (target - start) / steps;
    for (let s = 0; s < steps; s++) {
      arr[index] = Math.round(start + inc * (s + 1));
      this.paint();
      await sleep(16);
    }
    arr[index] = target;
    this.paint();
  }

  private async message(text: string): Promise<void> {
    this.logText = text;
    this.paint();
    await sleep(Math.min(2200, 500 + text.length * 26));
  }

  // -- victory --------------------------------------------------------------

  private async victory(): Promise<void> {
    const reward = this.engine.battle.collectRewards();
    await this.message('YOU WON!');
    await this.message(`Gained ${reward.exp} EXP and ${reward.money}$.`);
    for (const it of reward.items) {
      const d = ITEM_BY_ID.get(it);
      await this.message(`Found ${d?.name ?? it}!`);
    }
    for (const lu of reward.levelUps) {
      this.dispHp = this.engine.gs.party.map((p) => p.hp);
      this.dispPp = this.engine.gs.party.map((p) => p.pp);
      this.paint();
      await this.message(`${lu.name} grew to LV ${lu.toLevel}!`);
      for (const psi of lu.learned) {
        const d = PSI_BY_ID.get(psi);
        await this.message(`${lu.name} learned ${d?.name ?? psi}!`);
      }
    }
  }

  // -- menu selection -------------------------------------------------------

  private select(title: string, items: SelectItem[], cancelable: boolean): Promise<number> {
    return new Promise((resolve) => {
      let startIdx = items.findIndex((i) => !i.disabled);
      if (startIdx < 0) startIdx = 0;
      const render = (): void => {
        this.menuTitle = title;
        this.menuItems = items.map((it) => ({
          label: it.label,
          detail: it.detail,
          disabled: it.disabled,
        }));
        this.menuSelected = this.active?.index ?? startIdx;
        this.paint();
      };
      const resolveWrap = (i: number): void => {
        if (i >= 0 && items[i]?.disabled) {
          this.active = { index: startIdx, count: items.length, resolve: resolveWrap, cancelable, render };
          render();
          return;
        }
        resolve(i);
      };
      this.active = { index: startIdx, count: items.length, resolve: resolveWrap, cancelable, render };
      render();
    });
  }
}
