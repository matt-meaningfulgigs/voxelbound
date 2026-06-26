import {
  ENCOUNTER_BY_ID,
  ENEMY_BY_ID,
  ITEM_BY_ID,
  PSI_BY_ID,
  CHARACTER_BY_ID,
  type EnemyDef,
} from '@voxelbound/shared';
import type { GameState, PartyMemberState } from '../state/GameState';

export interface BattleEnemy {
  uid: number;
  defId: string;
  name: string;
  modelId: string;
  hp: number;
  maxHp: number;
  offense: number;
  defense: number;
  speed: number;
  isBoss: boolean;
}

export type BattleCommand =
  | { kind: 'bash'; actor: number; target: number }
  | { kind: 'psi'; actor: number; psi: string; target: number }
  | { kind: 'item'; actor: number; item: string; target: { side: 'party' | 'enemy'; index: number } }
  | { kind: 'defend'; actor: number }
  | { kind: 'run'; actor: number };

export type BattleEvent =
  | { kind: 'message'; text: string }
  | { kind: 'enemyDamage'; index: number; amount: number; smaaash: boolean }
  | { kind: 'enemyDown'; index: number; name: string }
  | { kind: 'partyDamage'; index: number; amount: number }
  | { kind: 'partyHeal'; index: number; amount: number }
  | { kind: 'partyPp'; index: number; amount: number }
  | { kind: 'partyDown'; index: number; name: string }
  | { kind: 'partyRevive'; index: number; name: string }
  | { kind: 'ranAway' }
  | { kind: 'enemyAppear'; modelId: string; name: string };

export interface LevelUpResult {
  name: string;
  fromLevel: number;
  toLevel: number;
  learned: string[];
}

export interface BattleReward {
  exp: number;
  money: number;
  items: string[];
  levelUps: LevelUpResult[];
}

export class BattleSystem {
  private gs: GameState;
  enemies: BattleEnemy[] = [];
  encounterId = '';
  isBossBattle = false;
  outcome: 'ongoing' | 'victory' | 'defeat' | 'ran' = 'ongoing';
  private uidSeq = 1;
  private defended = new Set<number>(); // party indices defending this round

  constructor(gs: GameState) {
    this.gs = gs;
  }

  get party(): PartyMemberState[] {
    return this.gs.party;
  }

  start(encounterId: string): BattleEvent[] {
    this.encounterId = encounterId;
    this.outcome = 'ongoing';
    this.enemies = [];
    const enc = ENCOUNTER_BY_ID.get(encounterId);
    const events: BattleEvent[] = [];
    if (!enc) return events;
    for (const g of enc.groups) {
      const def = ENEMY_BY_ID.get(g.enemy);
      if (!def) continue;
      const count = g.min + Math.floor(Math.random() * (g.max - g.min + 1));
      for (let i = 0; i < count; i++) this.enemies.push(this.makeEnemy(def));
    }
    this.isBossBattle = this.enemies.some((e) => e.isBoss);
    const names = this.enemies.map((e) => e.name);
    events.push({ kind: 'message', text: `${uniqueNames(names)} appeared!` });
    return events;
  }

  private makeEnemy(def: EnemyDef): BattleEnemy {
    return {
      uid: this.uidSeq++,
      defId: def.id,
      name: def.name,
      modelId: def.modelId,
      hp: def.maxHp,
      maxHp: def.maxHp,
      offense: def.offense,
      defense: def.defense,
      speed: def.speed,
      isBoss: !!def.isBoss,
    };
  }

  livingEnemies(): number[] {
    return this.enemies.map((e, i) => (e.hp > 0 ? i : -1)).filter((i) => i >= 0);
  }
  consciousParty(): number[] {
    return this.party.map((p, i) => (!p.downed ? i : -1)).filter((i) => i >= 0);
  }

  /** Resolve one full round. Mutates state; returns ordered events for the UI. */
  resolveRound(commands: BattleCommand[]): BattleEvent[] {
    const events: BattleEvent[] = [];
    this.defended.clear();

    interface Act { speed: number; run: () => void; }
    const acts: Act[] = [];

    for (const c of commands) {
      const actor = this.party[c.actor];
      if (!actor || actor.downed) continue;
      if (c.kind === 'defend') this.defended.add(c.actor);
      acts.push({
        speed: actor.speed + Math.random() * 2,
        run: () => this.runPartyCommand(c, events),
      });
    }

    for (let ei = 0; ei < this.enemies.length; ei++) {
      const e = this.enemies[ei]!;
      if (e.hp <= 0) continue;
      acts.push({
        speed: e.speed + Math.random() * 2,
        run: () => this.runEnemyAction(ei, events),
      });
    }

    acts.sort((a, b) => b.speed - a.speed);

    for (const a of acts) {
      if (this.outcome !== 'ongoing') break;
      a.run();
      this.confirmDowns(events);
      if (this.livingEnemies().length === 0) {
        this.outcome = 'victory';
        break;
      }
      if (this.consciousParty().length === 0) {
        this.outcome = 'defeat';
        break;
      }
    }
    return events;
  }

  private runPartyCommand(c: BattleCommand, events: BattleEvent[]): void {
    const actor = this.party[c.actor]!;
    if (actor.downed) return;
    switch (c.kind) {
      case 'bash': {
        const target = this.enemies[c.target];
        if (!target || target.hp <= 0) {
          const alt = this.livingEnemies()[0];
          if (alt === undefined) return;
          c = { ...c, target: alt };
        }
        const tgt = this.enemies[(c as { target: number }).target]!;
        const off = this.gs.effectiveOffense(actor);
        const smaaash = Math.random() < actor.guts / 100 + 0.04;
        let dmg = Math.max(1, Math.round(off - tgt.defense / 2 + (Math.random() * 6 - 3)));
        if (smaaash) dmg = Math.round(dmg * 2.2);
        tgt.hp = Math.max(0, tgt.hp - dmg);
        events.push({ kind: 'message', text: smaaash ? `${actor.name}'s SMAAAASH!! hit ${tgt.name}!` : `${actor.name} bashes ${tgt.name}!` });
        events.push({ kind: 'enemyDamage', index: this.enemies.indexOf(tgt), amount: dmg, smaaash });
        break;
      }
      case 'psi':
        this.runPsi(c.actor, c.psi, c.target, events);
        break;
      case 'item':
        this.runItem(c.actor, c.item, c.target, events);
        break;
      case 'defend':
        events.push({ kind: 'message', text: `${actor.name} takes a defensive stance.` });
        break;
      case 'run': {
        const partySpeed = Math.max(...this.consciousParty().map((i) => this.party[i]!.speed));
        const enemySpeed = Math.max(...this.livingEnemies().map((i) => this.enemies[i]!.speed));
        const chance = this.isBossBattle ? 0 : 0.45 + (partySpeed - enemySpeed) * 0.03;
        if (Math.random() < chance) {
          this.outcome = 'ran';
          events.push({ kind: 'message', text: 'You got away!' });
          events.push({ kind: 'ranAway' });
        } else {
          events.push({ kind: 'message', text: "Couldn't escape!" });
        }
        break;
      }
    }
  }

  private runPsi(actorIndex: number, psiId: string, target: number, events: BattleEvent[]): void {
    const actor = this.party[actorIndex]!;
    const psi = PSI_BY_ID.get(psiId);
    if (!psi) return;
    if (actor.pp < psi.ppCost) {
      events.push({ kind: 'message', text: `${actor.name} doesn't have enough PP!` });
      return;
    }
    actor.pp -= psi.ppCost;
    events.push({ kind: 'message', text: `${actor.name} uses ${psi.name}!` });
    events.push({ kind: 'partyPp', index: actorIndex, amount: psi.ppCost });

    const iqBonus = Math.round(actor.iq / 4);
    if (psi.kind === 'damage') {
      const targets = psi.target === 'all-enemies' ? this.livingEnemies() : [target];
      for (const ti of targets) {
        const e = this.enemies[ti];
        if (!e || e.hp <= 0) continue;
        const dmg = Math.max(1, psi.power + iqBonus + Math.round(Math.random() * 6 - 3) - Math.round(e.defense / 4));
        e.hp = Math.max(0, e.hp - dmg);
        events.push({ kind: 'enemyDamage', index: ti, amount: dmg, smaaash: false });
      }
    } else if (psi.kind === 'heal') {
      const targets = psi.target === 'all-allies' ? this.consciousParty() : [target];
      for (const ti of targets) {
        const p = this.party[ti];
        if (!p || p.downed) continue;
        const heal = psi.power + iqBonus;
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + heal);
        events.push({ kind: 'partyHeal', index: ti, amount: p.hp - before });
      }
    } else if (psi.kind === 'revive') {
      const p = this.party[target];
      if (p && p.downed) {
        p.downed = false;
        p.hp = Math.min(p.maxHp, psi.power);
        events.push({ kind: 'partyRevive', index: target, name: p.name });
        events.push({ kind: 'partyHeal', index: target, amount: p.hp });
      }
    }
  }

  private runItem(
    actorIndex: number,
    itemId: string,
    target: { side: 'party' | 'enemy'; index: number },
    events: BattleEvent[],
  ): void {
    const actor = this.party[actorIndex]!;
    const def = ITEM_BY_ID.get(itemId);
    if (!def || !this.gs.takeItem(itemId, 1)) return;
    events.push({ kind: 'message', text: `${actor.name} uses ${def.name}!` });
    const p = this.party[target.index];
    if (!p) return;
    if (def.revive && p.downed) {
      p.downed = false;
      p.hp = Math.min(p.maxHp, def.hpHeal ?? Math.round(p.maxHp / 2));
      events.push({ kind: 'partyRevive', index: target.index, name: p.name });
      events.push({ kind: 'partyHeal', index: target.index, amount: p.hp });
      return;
    }
    if (def.hpHeal && !p.downed) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + def.hpHeal);
      events.push({ kind: 'partyHeal', index: target.index, amount: p.hp - before });
    }
    if (def.ppHeal && !p.downed) {
      const before = p.pp;
      p.pp = Math.min(p.maxPp, p.pp + def.ppHeal);
      events.push({ kind: 'partyPp', index: target.index, amount: -(p.pp - before) });
    }
  }

  private runEnemyAction(enemyIndex: number, events: BattleEvent[]): void {
    const e = this.enemies[enemyIndex]!;
    if (e.hp <= 0) return;
    const targets = this.consciousParty();
    if (targets.length === 0) return;
    const ti = targets[Math.floor(Math.random() * targets.length)]!;
    const p = this.party[ti]!;
    let dmg = Math.max(1, Math.round(e.offense - this.gs.effectiveDefense(p) / 2 + (Math.random() * 6 - 3)));
    if (this.defended.has(ti)) dmg = Math.round(dmg / 2);
    p.hp = Math.max(0, p.hp - dmg);
    events.push({ kind: 'message', text: `${e.name} attacks ${p.name}!` });
    events.push({ kind: 'partyDamage', index: ti, amount: dmg });
  }

  private confirmDowns(events: BattleEvent[]): void {
    this.enemies.forEach((e, i) => {
      if (e.hp <= 0 && !(e as BattleEnemy & { _down?: boolean })._down) {
        (e as BattleEnemy & { _down?: boolean })._down = true;
        events.push({ kind: 'enemyDown', index: i, name: e.name });
      }
    });
    this.party.forEach((p, i) => {
      if (p.hp <= 0 && !p.downed) {
        p.downed = true;
        events.push({ kind: 'partyDown', index: i, name: p.name });
      }
    });
  }

  /** Compute victory rewards and apply EXP/level-ups + drops + money. */
  collectRewards(): BattleReward {
    let exp = 0;
    let money = 0;
    const items: string[] = [];
    for (const e of this.enemies) {
      const def = ENEMY_BY_ID.get(e.defId)!;
      exp += def.exp;
      money += def.money;
      for (const d of def.drops ?? []) if (Math.random() < d.chance) items.push(d.item);
    }
    this.gs.addMoney(money);
    for (const it of items) this.gs.giveItem(it);

    const levelUps: LevelUpResult[] = [];
    for (const p of this.consciousParty().map((i) => this.party[i]!)) {
      p.exp += exp;
      const lu = this.applyLevelUps(p);
      if (lu) levelUps.push(lu);
    }
    return { exp, money, items, levelUps };
  }

  private applyLevelUps(p: PartyMemberState): LevelUpResult | null {
    const def = CHARACTER_BY_ID.get(p.id);
    if (!def) return null;
    const from = p.level;
    const learned: string[] = [];
    while (p.exp >= expForLevel(p.level + 1)) {
      p.level += 1;
      p.maxHp += def.growth.hp;
      p.maxPp += def.growth.pp;
      p.offense += def.growth.offense;
      p.defense += def.growth.defense;
      p.speed += def.growth.speed;
      p.guts += def.growth.guts;
      p.iq += def.growth.iq;
      p.luck += def.growth.luck;
      p.hp = p.maxHp;
      p.pp = p.maxPp;
      for (const l of def.learnset ?? []) {
        if (l.level === p.level && !p.psi.includes(l.psi)) {
          p.psi.push(l.psi);
          learned.push(l.psi);
        }
      }
    }
    if (p.level === from) return null;
    return { name: p.name, fromLevel: from, toLevel: p.level, learned };
  }
}

export function expForLevel(level: number): number {
  // gentle quadratic curve
  return Math.round(8 * (level - 1) * level);
}

function uniqueNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${c} ${n}s` : `A ${n}`)).join(' and ');
}
