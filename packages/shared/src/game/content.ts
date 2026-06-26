import type {
  ItemDef,
  PsiDef,
  EnemyDef,
  EncounterDef,
  CharacterDef,
  DialogueScript,
  QuestDef,
  ShopDef,
  InteriorMap,
} from './types';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const ITEMS: ItemDef[] = [
  { id: 'bread', name: 'Bread Roll', desc: 'Restores 30 HP.', category: 'goods', price: 24, hpHeal: 30, battleUsable: true, overworldUsable: true },
  { id: 'cookie', name: 'Cookie', desc: 'Restores 12 HP.', category: 'goods', price: 8, hpHeal: 12, battleUsable: true, overworldUsable: true },
  { id: 'spring_water', name: 'Spring Water', desc: 'Restores 20 PP.', category: 'goods', price: 18, ppHeal: 20, battleUsable: true, overworldUsable: true },
  { id: 'revive_herb', name: 'Revive Herb', desc: 'Revives a fallen ally.', category: 'goods', price: 60, revive: true, hpHeal: 40, battleUsable: true, overworldUsable: true },
  { id: 'wooden_bat', name: 'Wooden Bat', desc: 'A trusty bat. OFFENSE +6.', category: 'weapon', price: 50, offense: 6, equipSlot: 'weapon' },
  { id: 'metal_bat', name: 'Metal Bat', desc: 'Heavier swing. OFFENSE +12.', category: 'weapon', price: 140, offense: 12, equipSlot: 'weapon' },
  { id: 'ball_cap', name: 'Baseball Cap', desc: 'DEFENSE +4.', category: 'body', price: 40, defense: 4, equipSlot: 'body' },
  { id: 'travel_coat', name: 'Travel Coat', desc: 'DEFENSE +9.', category: 'body', price: 110, defense: 9, equipSlot: 'body' },
  { id: 'friend_band', name: 'Friendship Band', desc: 'DEFENSE +2.', category: 'arms', price: 30, defense: 2, equipSlot: 'arms' },
  { id: 'locket', name: "Mara's Locket", desc: 'A small silver locket. It feels important.', category: 'key', price: 0 },
  { id: 'town_map', name: 'Town Map', desc: 'A hand-drawn map of Voxel Hollow.', category: 'key', price: 0 },
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

// ---------------------------------------------------------------------------
// PSI
// ---------------------------------------------------------------------------

export const PSI: PsiDef[] = [
  { id: 'flash_a', name: 'Flash α', tier: 'α', ppCost: 4, target: 'enemy', kind: 'damage', power: 22, desc: 'A burst of light. ~22 damage.' },
  { id: 'flash_b', name: 'Flash β', tier: 'β', ppCost: 8, target: 'all-enemies', kind: 'damage', power: 18, desc: 'Light strikes all foes.' },
  { id: 'lifeup_a', name: 'Lifeup α', tier: 'α', ppCost: 5, target: 'ally', kind: 'heal', power: 40, desc: 'Restores ~40 HP to one ally.' },
  { id: 'lifeup_b', name: 'Lifeup β', tier: 'β', ppCost: 10, target: 'all-allies', kind: 'heal', power: 30, desc: 'Heals the whole party.' },
  { id: 'revive_psi', name: 'Refresh Ω', tier: 'Ω', ppCost: 14, target: 'ally', kind: 'revive', power: 60, desc: 'Brings back a fallen ally.' },
];

export const PSI_BY_ID = new Map(PSI.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Enemies & encounters
// ---------------------------------------------------------------------------

export const ENEMIES: EnemyDef[] = [
  { id: 'spud_bug', name: 'Spud Bug', modelId: 'enemy_spud', maxHp: 18, offense: 8, defense: 3, speed: 6, exp: 8, money: 6, drops: [{ item: 'cookie', chance: 0.4 }] },
  { id: 'sky_pecker', name: 'Sky Pecker', modelId: 'enemy_crow', maxHp: 24, offense: 11, defense: 4, speed: 12, exp: 12, money: 9, drops: [{ item: 'cookie', chance: 0.3 }, { item: 'spring_water', chance: 0.15 }] },
  { id: 'mush_thug', name: 'Mush Thug', modelId: 'enemy_mush', maxHp: 34, offense: 13, defense: 7, speed: 7, exp: 18, money: 14, drops: [{ item: 'bread', chance: 0.3 }] },
  { id: 'meadow_brute', name: 'Meadow Brute', modelId: 'enemy_brute', maxHp: 90, offense: 18, defense: 9, speed: 8, exp: 80, money: 90, isBoss: true, drops: [{ item: 'metal_bat', chance: 1 }] },
];

export const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e]));

export const ENCOUNTERS: EncounterDef[] = [
  { id: 'grass_easy', weight: 3, groups: [{ enemy: 'spud_bug', min: 1, max: 2 }] },
  { id: 'grass_mix', weight: 2, groups: [{ enemy: 'spud_bug', min: 1, max: 1 }, { enemy: 'sky_pecker', min: 1, max: 1 }] },
  { id: 'grass_tough', weight: 1, groups: [{ enemy: 'mush_thug', min: 1, max: 2 }] },
  { id: 'boss_brute', weight: 0, groups: [{ enemy: 'meadow_brute', min: 1, max: 1 }] },
];

export const ENCOUNTER_BY_ID = new Map(ENCOUNTERS.map((e) => [e.id, e]));

/** Encounter table used by overworld grass zones (weighted random). */
export const OVERWORLD_ENCOUNTER_TABLE = ['grass_easy', 'grass_mix', 'grass_tough'];

// ---------------------------------------------------------------------------
// Party characters
// ---------------------------------------------------------------------------

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'vox',
    name: 'Vox',
    modelId: 'hero',
    level: 1,
    maxHp: 60,
    maxPp: 24,
    offense: 12,
    defense: 8,
    speed: 11,
    guts: 8,
    iq: 10,
    luck: 7,
    psi: ['flash_a', 'lifeup_a'],
    growth: { hp: 8, pp: 4, offense: 3, defense: 2, speed: 2, guts: 1, iq: 2, luck: 1 },
    learnset: [
      { level: 4, psi: 'flash_b' },
      { level: 6, psi: 'lifeup_b' },
      { level: 9, psi: 'revive_psi' },
    ],
  },
  {
    id: 'pip',
    name: 'Pip',
    modelId: 'villager_orange',
    level: 2,
    maxHp: 48,
    maxPp: 18,
    offense: 15,
    defense: 7,
    speed: 14,
    guts: 12,
    iq: 7,
    luck: 9,
    psi: [],
    growth: { hp: 9, pp: 2, offense: 4, defense: 2, speed: 3, guts: 2, iq: 1, luck: 2 },
    learnset: [],
  },
];

export const CHARACTER_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export const STARTING_PARTY = ['vox'];
export const STARTING_INVENTORY = ['bread', 'bread', 'cookie', 'spring_water', 'wooden_bat', 'ball_cap'];
export const STARTING_MONEY = 40;

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const QUESTS: QuestDef[] = [
  {
    id: 'find_locket',
    title: 'The Lost Locket',
    stages: [
      { objective: 'Search the eastern meadow for Mara’s locket.' },
      { objective: 'Return the locket to Mara by the fountain.' },
    ],
    reward: { exp: 60, money: 80, flags: ['mara_grateful'] },
  },
];

export const QUEST_BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

export const SHOPS: ShopDef[] = [
  {
    id: 'general_store',
    name: 'Hollow General Store',
    greeting: 'Welcome! What can I get for you?',
    items: ['bread', 'cookie', 'spring_water', 'revive_herb', 'wooden_bat', 'metal_bat', 'ball_cap', 'travel_coat', 'friend_band'],
  },
];

export const SHOP_BY_ID = new Map(SHOPS.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

export const DIALOGUES: DialogueScript[] = [
  {
    id: 'mara',
    start: [
      { condition: { t: 'quest', quest: 'find_locket', op: 'completed' }, node: 'thanks' },
      { condition: { t: 'and', cs: [{ t: 'quest', quest: 'find_locket', op: '>=', stage: 1 }, { t: 'hasItem', item: 'locket' }] }, node: 'return' },
      { condition: { t: 'quest', quest: 'find_locket', op: 'active' }, node: 'remind' },
      { node: 'intro' },
    ],
    nodes: {
      intro: {
        speaker: 'Mara',
        lines: [
          'Oh! A traveler. Thank goodness.',
          'I dropped my grandmother’s locket somewhere in the eastern meadow… but the grass there is crawling with critters.',
          'Could you find it for me? Please?',
        ],
        actions: [{ t: 'startQuest', quest: 'find_locket' }],
        goto: 'remind',
      },
      remind: {
        speaker: 'Mara',
        lines: ['The meadow is east of town, past the tall grass. Be careful out there!'],
      },
      return: {
        speaker: 'Mara',
        lines: [
          'You found it! My locket!',
          'I can’t thank you enough. Here, take this for your trouble.',
        ],
        actions: [
          { t: 'take', item: 'locket' },
          { t: 'completeQuest', quest: 'find_locket' },
          { t: 'money', amount: 80 },
        ],
        goto: 'thanks',
      },
      thanks: {
        speaker: 'Mara',
        lines: ['You’re a real hero. The whole hollow is talking about you!'],
      },
    },
  },
  {
    id: 'greeter',
    start: [{ node: 'a' }],
    nodes: {
      a: {
        speaker: 'Villager',
        lines: ['Welcome to Voxel Hollow! Lovely day, isn’t it?'],
        choices: [
          { label: 'It sure is.', goto: 'nice' },
          { label: 'Where am I?', goto: 'where' },
          { label: 'Goodbye.' },
        ],
      },
      nice: { speaker: 'Villager', lines: ['Enjoy your stay!'] },
      where: {
        speaker: 'Villager',
        lines: ['This is Voxel Hollow. The store is in the house with the red roof, and the inn has the blue roof. Press TAB anytime to open your menu.'],
      },
    },
  },
  {
    id: 'kid',
    start: [
      { condition: { t: 'flag', key: 'kid_gift', value: true }, node: 'after' },
      { node: 'a' },
    ],
    nodes: {
      a: {
        speaker: 'Kid',
        lines: ['I found a cookie but I’m too full. You want it?'],
        choices: [
          { label: 'Sure, thanks!', goto: 'give', actions: [{ t: 'give', item: 'cookie' }, { t: 'flag', key: 'kid_gift', value: true }] },
          { label: 'No thanks.' },
        ],
      },
      give: { speaker: 'Kid', lines: ['Here ya go! The meadow east of town has monsters, by the way. Watch out!'] },
      after: { speaker: 'Kid', lines: ['Did you beat any monsters yet? So cool!'] },
    },
  },
  {
    id: 'pip_recruit',
    start: [
      { condition: { t: 'flag', key: 'pip_joined', value: true }, node: 'joined' },
      { condition: { t: 'quest', quest: 'find_locket', op: 'completed' }, node: 'join' },
      { node: 'wait' },
    ],
    nodes: {
      wait: {
        speaker: 'Pip',
        lines: ['You’re that traveler helping Mara, right? If you ever clear out those meadow monsters, I’d love to come along.'],
      },
      join: {
        speaker: 'Pip',
        lines: [
          'You really helped Mara out — and you’re tough enough for the meadow!',
          'Mind if I join you? Two are stronger than one!',
        ],
        choices: [
          { label: 'Welcome aboard!', goto: 'joined', actions: [{ t: 'joinParty', character: 'pip' }, { t: 'flag', key: 'pip_joined', value: true }] },
          { label: 'Maybe later.' },
        ],
      },
      joined: { speaker: 'Pip', lines: ['Let’s find some adventure!'] },
    },
  },
  {
    id: 'shopkeeper',
    start: [{ node: 'a' }],
    nodes: {
      a: {
        speaker: 'Shopkeeper',
        lines: ['Welcome to the General Store!'],
        choices: [
          { label: 'Shop', actions: [{ t: 'shop', shop: 'general_store' }] },
          { label: 'Just looking.' },
        ],
      },
    },
  },
  {
    id: 'innkeeper',
    start: [{ node: 'a' }],
    nodes: {
      a: {
        speaker: 'Innkeeper',
        lines: ['Rest up at the Hollow Inn? It’s 10$ a night — fully restores and saves your journey.'],
        choices: [
          { label: 'Rest (10$)', goto: 'rest', actions: [{ t: 'money', amount: -10 }, { t: 'heal' }, { t: 'flag', key: 'rested', value: true }] },
          { label: 'Not now.' },
        ],
      },
      rest: { speaker: 'Innkeeper', lines: ['Good night! …And good morning! You’re fully rested.'] },
    },
  },
  {
    id: 'sign_town',
    start: [{ node: 'a' }],
    nodes: { a: { lines: ['“Welcome to VOXEL HOLLOW — pop. cozy. Eastern meadow: monsters! Enter at your own risk.”'] } },
  },
  {
    id: 'meadow_locket',
    start: [
      { condition: { t: 'hasItem', item: 'locket' }, node: 'empty' },
      { condition: { t: 'quest', quest: 'find_locket', op: 'notStarted' }, node: 'glint' },
      { node: 'found' },
    ],
    nodes: {
      glint: {
        lines: ['Something glints in the grass… but a huge shape rises up to guard it!'],
        actions: [{ t: 'battle', encounter: 'boss_brute' }],
        goto: 'found',
      },
      found: {
        lines: ['You pick up a small silver locket. This must be Mara’s!'],
        actions: [{ t: 'give', item: 'locket' }, { t: 'advanceQuest', quest: 'find_locket' }],
      },
      empty: { lines: ['Just rustling grass now.'] },
    },
  },
  {
    id: 'townsfolk_1',
    start: [{ node: 'a' }],
    nodes: {
      a: { speaker: 'Townsfolk', lines: ['They say the grass out east lies flat where the big critters drag their tails through it.'] },
    },
  },
  {
    id: 'townsfolk_2',
    start: [{ node: 'a' }],
    nodes: {
      a: { speaker: 'Townsfolk', lines: ['The fountain’s been running since before my grandpa’s time. Never runs dry, never overflows.'] },
    },
  },
  {
    id: 'townsfolk_3',
    start: [{ node: 'a' }],
    nodes: {
      a: { speaker: 'Townsfolk', lines: ['Careful by the water — the lake’s deeper than it looks. Best keep to the grass.'] },
    },
  },
  {
    id: 'townsfolk_4',
    start: [{ node: 'a' }],
    nodes: {
      a: { speaker: 'Old Timer', lines: ['Hills to the north, sea to the south. A fine little hollow, if you ask me.'] },
    },
  },
  {
    id: 'townsfolk_5',
    start: [{ node: 'a' }],
    nodes: {
      a: { speaker: 'Townsfolk', lines: ['You look like an adventurer. We don’t get many of those around here!'] },
    },
  },
];

export const DIALOGUE_BY_ID = new Map(DIALOGUES.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// Interior maps (house interiors you can enter)
// ---------------------------------------------------------------------------

export const INTERIORS: InteriorMap[] = [
  {
    id: 'store_interior',
    name: 'General Store',
    w: 120,
    d: 96,
    floorColor: 0xb8966a,
    wallColor: 0xd9c4a0,
    bgColor: 0x2a2620,
    npcs: [{ id: 'shopkeeper', modelId: 'villager_gray', x: 60, z: 32, facing: 2, dialogue: 'shopkeeper' }],
    doors: [{ x: 60, z: 86, toMap: 'overworld', toX: 130, toZ: 198 }],
    signs: [{ x: 92, z: 40, dialogue: 'sign_town' }],
  },
  {
    id: 'inn_interior',
    name: 'Hollow Inn',
    w: 120,
    d: 96,
    floorColor: 0x9a7a8a,
    wallColor: 0xc9b0c0,
    bgColor: 0x241f26,
    npcs: [{ id: 'innkeeper', modelId: 'villager_teal', x: 60, z: 32, facing: 2, dialogue: 'innkeeper' }],
    doors: [{ x: 60, z: 86, toMap: 'overworld', toX: 210, toZ: 198 }],
  },
  {
    id: 'home_interior',
    name: 'Cozy Home',
    w: 110,
    d: 90,
    floorColor: 0xa88c5a,
    wallColor: 0xd8c49c,
    bgColor: 0x262019,
    npcs: [{ id: 'kid', modelId: 'villager_pink', x: 50, z: 34, facing: 2, dialogue: 'kid', wander: true }],
    doors: [{ x: 55, z: 80, toMap: 'overworld', toX: 300, toZ: 198 }],
  },
];

export const INTERIOR_BY_ID = new Map(INTERIORS.map((m) => [m.id, m]));
