import { QUEST_BY_ID, type Condition, type ScriptAction } from '@voxelbound/shared';
import type { GameState } from '../state/GameState';

export interface ScriptHooks {
  onBattle?: (encounterId: string) => void;
  onShop?: (shopId: string) => void;
  onWarp?: (map: string, x: number, z: number) => void;
  onJoin?: (characterId: string) => void;
  onSfx?: (id: string) => void;
  onQuestChanged?: (questId: string) => void;
  onMoney?: (delta: number) => void;
  onItem?: (item: string, delta: number) => void;
}

export function evalCondition(gs: GameState, cond?: Condition): boolean {
  if (!cond) return true;
  switch (cond.t) {
    case 'flag':
      return gs.getFlag(cond.key) === (cond.value ?? true);
    case 'hasItem':
      return gs.hasItem(cond.item);
    case 'var': {
      const v = gs.getVar(cond.key);
      if (cond.op === '>=') return v >= cond.value;
      if (cond.op === '==') return v === cond.value;
      return v < cond.value;
    }
    case 'quest': {
      const stage = gs.questStage(cond.quest);
      const def = QUEST_BY_ID.get(cond.quest);
      const total = def ? def.stages.length : 0;
      switch (cond.op) {
        case 'notStarted':
          return stage < 0;
        case 'active':
          return stage >= 0 && stage < total;
        case 'completed':
          return stage >= total && stage >= 0;
        case '>=':
          return stage >= (cond.stage ?? 0);
        case '==':
          return stage === (cond.stage ?? 0);
        case '<':
          return stage < (cond.stage ?? 0);
      }
      return false;
    }
    case 'not':
      return !evalCondition(gs, cond.c);
    case 'and':
      return cond.cs.every((c) => evalCondition(gs, c));
    case 'or':
      return cond.cs.some((c) => evalCondition(gs, c));
  }
}

/** Apply a single script action. Returns true if it pauses dialogue (battle/shop). */
export function applyAction(gs: GameState, a: ScriptAction, hooks: ScriptHooks): boolean {
  switch (a.t) {
    case 'flag':
      gs.setFlag(a.key, a.value);
      return false;
    case 'setVar':
      gs.setVar(a.key, a.value);
      return false;
    case 'addVar':
      gs.addVar(a.key, a.value);
      return false;
    case 'give':
      gs.giveItem(a.item, a.qty ?? 1);
      hooks.onItem?.(a.item, a.qty ?? 1);
      return false;
    case 'take':
      gs.takeItem(a.item, a.qty ?? 1);
      hooks.onItem?.(a.item, -(a.qty ?? 1));
      return false;
    case 'money':
      gs.addMoney(a.amount);
      hooks.onMoney?.(a.amount);
      return false;
    case 'startQuest':
      gs.startQuest(a.quest);
      hooks.onQuestChanged?.(a.quest);
      return false;
    case 'advanceQuest':
      gs.setQuestStage(a.quest, gs.questStage(a.quest) + 1);
      hooks.onQuestChanged?.(a.quest);
      return false;
    case 'completeQuest':
      completeQuest(gs, a.quest, hooks);
      return false;
    case 'heal':
      gs.healParty();
      return false;
    case 'joinParty':
      gs.joinParty(a.character);
      hooks.onJoin?.(a.character);
      return false;
    case 'sfx':
      hooks.onSfx?.(a.id);
      return false;
    case 'warp':
      hooks.onWarp?.(a.map, a.x, a.z);
      return true;
    case 'battle':
      hooks.onBattle?.(a.encounter);
      return true;
    case 'shop':
      hooks.onShop?.(a.shop);
      return true;
  }
}

export function completeQuest(gs: GameState, questId: string, hooks: ScriptHooks): void {
  const def = QUEST_BY_ID.get(questId);
  if (!def) return;
  gs.setQuestStage(questId, def.stages.length);
  const r = def.reward;
  if (r) {
    if (r.money) {
      gs.addMoney(r.money);
      hooks.onMoney?.(r.money);
    }
    if (r.items) for (const it of r.items) gs.giveItem(it);
    if (r.flags) for (const f of r.flags) gs.setFlag(f, true);
    if (r.exp) {
      // award exp to whole party via a flag the battle/level system can read;
      // simplest: add directly to each member's exp (level handled elsewhere)
      for (const p of gs.party) p.exp += r.exp;
    }
  }
  hooks.onQuestChanged?.(questId);
}
