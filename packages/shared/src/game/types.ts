// ---------------------------------------------------------------------------
// RPG data model — items, PSI, enemies, encounters, dialogue, quests, shops,
// party characters, and interior maps. All content is plain serializable data.
// ---------------------------------------------------------------------------

export type ItemCategory = 'key' | 'goods' | 'weapon' | 'body' | 'arms' | 'other';
export type EquipSlot = 'weapon' | 'body' | 'arms' | 'other';

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  category: ItemCategory;
  price: number;
  hpHeal?: number;
  ppHeal?: number;
  revive?: boolean;
  curesStatus?: boolean;
  offense?: number;
  defense?: number;
  equipSlot?: EquipSlot;
  battleUsable?: boolean;
  overworldUsable?: boolean;
}

export type PsiTarget = 'enemy' | 'all-enemies' | 'ally' | 'all-allies' | 'self';
export type PsiKind = 'damage' | 'heal' | 'revive';

export interface PsiDef {
  id: string;
  name: string;
  tier: string;
  ppCost: number;
  target: PsiTarget;
  kind: PsiKind;
  power: number;
  desc: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  modelId: string;
  maxHp: number;
  offense: number;
  defense: number;
  speed: number;
  exp: number;
  money: number;
  isBoss?: boolean;
  drops?: Array<{ item: string; chance: number }>;
}

export interface EncounterDef {
  id: string;
  groups: Array<{ enemy: string; min: number; max: number }>;
  weight: number;
}

export interface GrowthCurve {
  hp: number;
  pp: number;
  offense: number;
  defense: number;
  speed: number;
  guts: number;
  iq: number;
  luck: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  modelId: string;
  level: number;
  maxHp: number;
  maxPp: number;
  offense: number;
  defense: number;
  speed: number;
  guts: number;
  iq: number;
  luck: number;
  psi: string[];
  growth: GrowthCurve;
  learnset?: Array<{ level: number; psi: string }>;
}

// -- dialogue & scripting ---------------------------------------------------

export type ScriptAction =
  | { t: 'flag'; key: string; value: boolean }
  | { t: 'setVar'; key: string; value: number }
  | { t: 'addVar'; key: string; value: number }
  | { t: 'give'; item: string; qty?: number }
  | { t: 'take'; item: string; qty?: number }
  | { t: 'money'; amount: number }
  | { t: 'startQuest'; quest: string }
  | { t: 'advanceQuest'; quest: string }
  | { t: 'completeQuest'; quest: string }
  | { t: 'heal' }
  | { t: 'battle'; encounter: string }
  | { t: 'shop'; shop: string }
  | { t: 'joinParty'; character: string }
  | { t: 'warp'; map: string; x: number; z: number }
  | { t: 'sfx'; id: string };

export type Condition =
  | { t: 'flag'; key: string; value?: boolean }
  | { t: 'quest'; quest: string; op: '>=' | '==' | '<' | 'active' | 'completed' | 'notStarted'; stage?: number }
  | { t: 'hasItem'; item: string }
  | { t: 'var'; key: string; op: '>=' | '==' | '<'; value: number }
  | { t: 'not'; c: Condition }
  | { t: 'and'; cs: Condition[] }
  | { t: 'or'; cs: Condition[] };

export interface DialogueChoice {
  label: string;
  goto?: string;
  actions?: ScriptAction[];
  condition?: Condition;
}

export interface DialogueNode {
  /** Pages of text; each is shown with the typewriter, advanced by confirm. */
  lines: string[];
  /** Speaker label shown above the box. */
  speaker?: string;
  /** Actions run when the node's text finishes (before choices). */
  actions?: ScriptAction[];
  /** Branching choices presented after the text. */
  choices?: DialogueChoice[];
  /** Unconditional jump to another node when text (and actions) complete. */
  goto?: string;
}

export interface DialogueScript {
  id: string;
  /** First matching start rule's node is used; last rule should be unconditional. */
  start: Array<{ condition?: Condition; node: string }>;
  nodes: Record<string, DialogueNode>;
}

// -- quests -----------------------------------------------------------------

export interface QuestDef {
  id: string;
  title: string;
  stages: Array<{ objective: string }>;
  reward?: { exp?: number; money?: number; items?: string[]; flags?: string[] };
}

// -- shops ------------------------------------------------------------------

export interface ShopDef {
  id: string;
  name: string;
  greeting: string;
  items: string[];
}

// -- maps (interiors) -------------------------------------------------------

export interface MapNpc {
  id: string;
  modelId: string;
  x: number;
  z: number;
  facing: 0 | 1 | 2 | 3;
  dialogue?: string;
  wander?: boolean;
  condition?: Condition; // only spawns when condition holds
}

export interface MapDoor {
  x: number;
  z: number;
  toMap: string;
  toX: number;
  toZ: number;
  /** If set, the player must be facing this direction to enter. */
  enterFacing?: 0 | 1 | 2 | 3;
}

export interface MapProp {
  modelId: string;
  x: number;
  z: number;
  facing?: 0 | 1 | 2 | 3;
}

export interface InteriorMap {
  id: string;
  name: string;
  w: number;
  d: number;
  floorColor: number;
  wallColor: number;
  npcs: MapNpc[];
  doors: MapDoor[];
  signs?: Array<{ x: number; z: number; dialogue: string }>;
  props?: MapProp[];
  bgColor?: number;
}
