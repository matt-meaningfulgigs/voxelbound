import {
  CHARACTER_BY_ID,
  ITEM_BY_ID,
  STARTING_INVENTORY,
  STARTING_MONEY,
  STARTING_PARTY,
  type CharacterDef,
  type EquipSlot,
} from '@voxelbound/shared';

export const SAVE_SCHEMA_VERSION = 2;

/** Generate a fresh 32-bit world seed. */
export function randomWorldSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export interface PartyMemberState {
  id: string;
  name: string;
  modelId: string;
  level: number;
  exp: number;
  hp: number;
  pp: number;
  maxHp: number;
  maxPp: number;
  offense: number;
  defense: number;
  speed: number;
  guts: number;
  iq: number;
  luck: number;
  psi: string[];
  equip: Partial<Record<EquipSlot, string>>;
  downed: boolean;
}

export interface InventoryEntry {
  item: string;
  qty: number;
}

export interface GameStateData {
  schemaVersion: number;
  party: PartyMemberState[];
  inventory: InventoryEntry[];
  money: number;
  flags: Record<string, boolean>;
  vars: Record<string, number>;
  quests: Record<string, number>; // questId -> current stage index (>= stages.length = done)
  worldState: Record<string, boolean>; // taken items, opened things, etc.
  map: string;
  playerX: number;
  playerZ: number;
  playTimeMs: number;
  /** Seed driving all procedural world generation; stable for the save's lifetime. */
  worldSeed: number;
}

function makePartyMember(def: CharacterDef): PartyMemberState {
  return {
    id: def.id,
    name: def.name,
    modelId: def.modelId,
    level: def.level,
    exp: 0,
    hp: def.maxHp,
    pp: def.maxPp,
    maxHp: def.maxHp,
    maxPp: def.maxPp,
    offense: def.offense,
    defense: def.defense,
    speed: def.speed,
    guts: def.guts,
    iq: def.iq,
    luck: def.luck,
    psi: [...def.psi],
    equip: {},
    downed: false,
  };
}

/** Mutable game state. Single source of truth; serialized into saves. */
export class GameState {
  data: GameStateData;

  constructor(data?: GameStateData) {
    this.data = data ?? GameState.newGame();
  }

  static newGame(): GameStateData {
    const party = STARTING_PARTY.map((id) => makePartyMember(CHARACTER_BY_ID.get(id)!));
    const inv: InventoryEntry[] = [];
    for (const item of STARTING_INVENTORY) {
      const e = inv.find((x) => x.item === item);
      if (e) e.qty += 1;
      else inv.push({ item, qty: 1 });
    }
    // auto-equip the starting bat/cap onto the leader
    const leader = party[0]!;
    leader.equip.weapon = 'wooden_bat';
    leader.equip.body = 'ball_cap';

    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      party,
      inventory: inv,
      money: STARTING_MONEY,
      flags: {},
      vars: {},
      quests: {},
      worldState: {},
      map: 'overworld',
      playerX: 0,
      playerZ: 0,
      playTimeMs: 0,
      worldSeed: randomWorldSeed(),
    };
  }

  // -- flags / vars ---------------------------------------------------------

  getFlag(key: string): boolean {
    return !!this.data.flags[key];
  }
  setFlag(key: string, value: boolean): void {
    this.data.flags[key] = value;
  }
  getVar(key: string): number {
    return this.data.vars[key] ?? 0;
  }
  setVar(key: string, value: number): void {
    this.data.vars[key] = value;
  }
  addVar(key: string, value: number): void {
    this.data.vars[key] = (this.data.vars[key] ?? 0) + value;
  }

  // -- quests ---------------------------------------------------------------

  questStage(id: string): number {
    return this.data.quests[id] ?? -1; // -1 = not started
  }
  startQuest(id: string): void {
    if (this.data.quests[id] === undefined) this.data.quests[id] = 0;
  }
  setQuestStage(id: string, stage: number): void {
    this.data.quests[id] = stage;
  }

  // -- inventory ------------------------------------------------------------

  hasItem(item: string): boolean {
    return this.data.inventory.some((e) => e.item === item && e.qty > 0);
  }
  itemCount(item: string): number {
    return this.data.inventory.find((e) => e.item === item)?.qty ?? 0;
  }
  giveItem(item: string, qty = 1): void {
    const e = this.data.inventory.find((x) => x.item === item);
    if (e) e.qty += qty;
    else this.data.inventory.push({ item, qty });
  }
  takeItem(item: string, qty = 1): boolean {
    const e = this.data.inventory.find((x) => x.item === item);
    if (!e || e.qty < qty) return false;
    e.qty -= qty;
    if (e.qty <= 0) {
      this.data.inventory = this.data.inventory.filter((x) => x.item !== item);
    }
    return true;
  }

  // -- money ----------------------------------------------------------------

  get money(): number {
    return this.data.money;
  }
  addMoney(amount: number): void {
    this.data.money = Math.max(0, this.data.money + amount);
  }

  // -- party ----------------------------------------------------------------

  get party(): PartyMemberState[] {
    return this.data.party;
  }
  leader(): PartyMemberState {
    return this.data.party[0]!;
  }
  hasPartyMember(id: string): boolean {
    return this.data.party.some((p) => p.id === id);
  }
  joinParty(id: string): void {
    if (this.hasPartyMember(id)) return;
    const def = CHARACTER_BY_ID.get(id);
    if (def) this.data.party.push(makePartyMember(def));
  }

  /** Effective stat including equipment bonuses. */
  effectiveOffense(p: PartyMemberState): number {
    return p.offense + this.equipBonus(p, 'offense');
  }
  effectiveDefense(p: PartyMemberState): number {
    return p.defense + this.equipBonus(p, 'defense');
  }
  private equipBonus(p: PartyMemberState, stat: 'offense' | 'defense'): number {
    let total = 0;
    for (const slot of Object.keys(p.equip) as EquipSlot[]) {
      const itemId = p.equip[slot];
      if (!itemId) continue;
      const def = ITEM_BY_ID.get(itemId);
      if (def && def[stat]) total += def[stat]!;
    }
    return total;
  }

  healParty(): void {
    for (const p of this.data.party) {
      p.hp = p.maxHp;
      p.pp = p.maxPp;
      p.downed = false;
    }
  }
}
