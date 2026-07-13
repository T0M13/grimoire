import {
  ABILITIES, SKILLS, SKILL_ABILITY,
  type Ability, type AbilityMethod, type AbilityScores, type Alignment, type Character,
  type CheckIntent, type CheckRequest, type ClassName, type Difficulty, type RaceName, type RollResult, type Skill,
} from "@grimoire/shared";

/** Deterministic RNG (mulberry32) so every mechanic is reproducible in tests and replays. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function rollDie(sides: number, rng: Rng): number {
  if (!Number.isInteger(sides) || sides < 2) throw new Error(`invalid die d${sides}`);
  return 1 + Math.floor(rng() * sides);
}

export interface DiceRoll {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
}

const NOTATION = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

/** Parse and roll `NdM`, `NdM+K`, `NdM-K`, `dM`. */
export function roll(notation: string, rng: Rng): DiceRoll {
  const m = NOTATION.exec(notation);
  if (!m) throw new Error(`invalid dice notation: "${notation}"`);
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  if (count < 1 || count > 100) throw new Error(`invalid dice count in "${notation}"`);
  const modifier = m[3] ? (m[3] === "-" ? -1 : 1) * parseInt(m[4]!, 10) : 0;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides, rng));
  return { notation, rolls, modifier, total: rolls.reduce((a, b) => a + b, 0) + modifier };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function skillModifier(character: Character, skill: Skill): number {
  const ability: Ability = SKILL_ABILITY[skill];
  const base = abilityModifier(character.abilities[ability] ?? 10);
  const prof = character.proficientSkills.includes(skill) ? character.proficiencyBonus : 0;
  return base + prof;
}

export type Advantage = "none" | "advantage" | "disadvantage";

export function d20(rng: Rng, adv: Advantage = "none"): { die: number; raw: number[] } {
  const a = rollDie(20, rng);
  if (adv === "none") return { die: a, raw: [a] };
  const b = rollDie(20, rng);
  const die = adv === "advantage" ? Math.max(a, b) : Math.min(a, b);
  return { die, raw: [a, b] };
}

/** Resolve a skill check for a character. Natural 20 always succeeds, natural 1 always fails. */
export function resolveCheck(
  character: Character,
  check: CheckRequest,
  rng: Rng,
  adv: Advantage = "none",
): RollResult {
  const { die } = d20(rng, adv);
  const modifier = skillModifier(character, check.skill);
  const total = die + modifier;
  // 2014 RAW: natural 1/20 have no automatic effect on ability checks.
  const critical = "none" as const;
  const success = total >= check.dc;
  return {
    playerName: check.playerName,
    skill: check.skill,
    dc: check.dc,
    die,
    modifier,
    total,
    success,
    critical,
  };
}

export const DIFFICULTY_CLASS: Record<Difficulty, number> = {
  very_easy: 5,
  easy: 10,
  moderate: 15,
  hard: 20,
  very_hard: 25,
  nearly_impossible: 30,
};

export function checkRequestFromIntent(intent: CheckIntent): CheckRequest {
  return {
    playerName: intent.playerName,
    skill: intent.skill,
    dc: DIFFICULTY_CLASS[intent.difficulty],
    reason: intent.reason,
  };
}

export function applyDamage(character: Character, amount: number): Character {
  return { ...character, hp: Math.max(0, character.hp - Math.max(0, amount)) };
}

export function heal(character: Character, amount: number): Character {
  return { ...character, hp: Math.min(character.maxHp, character.hp + Math.max(0, amount)) };
}

// ---------- SRD 5.1 (2014 rules) character creation ----------

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export interface EquipmentPackage {
  id: string;
  label: string;
  items: readonly string[];
  armor: "unarmored" | "barbarian" | "monk" | "draconic" | "leather" | "scale" | "chain";
  shield?: boolean;
}

export interface ClassBuildRules {
  id: string;
  className: ClassName;
  summary: string;
  primaryAbilities: readonly Ability[];
  hitDie: 6 | 8 | 10 | 12;
  savingThrows: readonly Ability[];
  skillChoices: readonly Skill[];
  skillCount: number;
  recommendedSkills: readonly Skill[];
  recommendedAbilities: AbilityScores;
  equipmentPackages: readonly EquipmentPackage[];
  levelOneFeatures: readonly string[];
  defaultSpells: readonly string[];
}

const ANY_SKILLS = [...SKILLS] as readonly Skill[];

export const CLASS_BUILD_RULES: Record<ClassName, ClassBuildRules> = {
  Barbarian: {
    id: "barbarian", className: "Barbarian", summary: "Primal fury, endurance, and overwhelming strength.",
    primaryAbilities: ["STR"], hitDie: 12, savingThrows: ["STR", "CON"], skillCount: 2,
    skillChoices: ["Animal Handling", "Athletics", "Intimidation", "Nature", "Perception", "Survival"],
    recommendedSkills: ["Athletics", "Perception"],
    recommendedAbilities: { STR: 15, DEX: 13, CON: 14, INT: 8, WIS: 12, CHA: 10 },
    equipmentPackages: [
      { id: "greataxe", label: "Greataxe", items: ["greataxe", "2 handaxes", "explorer's pack", "4 javelins"], armor: "barbarian" },
      { id: "greatsword", label: "Greatsword", items: ["greatsword", "2 handaxes", "explorer's pack", "4 javelins"], armor: "barbarian" },
    ],
    levelOneFeatures: ["Rage (2/Long Rest)", "Unarmored Defense"], defaultSpells: [],
  },
  Bard: {
    id: "bard", className: "Bard", summary: "Inspiration, expertise, performance, and versatile magic.",
    primaryAbilities: ["CHA"], hitDie: 8, savingThrows: ["DEX", "CHA"], skillCount: 3,
    skillChoices: ANY_SKILLS, recommendedSkills: ["Performance", "Persuasion", "Insight"],
    recommendedAbilities: { STR: 8, DEX: 14, CON: 13, INT: 10, WIS: 12, CHA: 15 },
    equipmentPackages: [
      { id: "diplomat", label: "Diplomat", items: ["rapier", "diplomat's pack", "lute", "leather armor", "dagger"], armor: "leather" },
      { id: "entertainer", label: "Entertainer", items: ["longsword", "entertainer's pack", "flute", "leather armor", "dagger"], armor: "leather" },
    ],
    levelOneFeatures: ["Spellcasting", "Bardic Inspiration (D6)"],
    defaultSpells: ["Dancing Lights (Cantrip)", "Vicious Mockery (Cantrip)", "Charm Person", "Detect Magic", "Healing Word", "Thunderwave"],
  },
  Fighter: {
    id: "fighter", className: "Fighter", summary: "Weapons, armor, tactical flexibility, and staying power.",
    primaryAbilities: ["STR", "DEX"], hitDie: 10, savingThrows: ["STR", "CON"], skillCount: 2,
    recommendedSkills: ["Athletics", "Perception"],
    skillChoices: ["Acrobatics", "Animal Handling", "Athletics", "History", "Insight", "Intimidation", "Perception", "Survival"],
    recommendedAbilities: { STR: 15, DEX: 14, CON: 13, INT: 8, WIS: 10, CHA: 12 },
    equipmentPackages: [
      { id: "guardian", label: "Guardian", items: ["chain mail", "longsword", "shield", "light crossbow", "20 bolts", "explorer's pack"], armor: "chain", shield: true },
      { id: "archer", label: "Archer", items: ["leather armor", "longbow", "20 arrows", "2 shortswords", "2 handaxes", "dungeoneer's pack"], armor: "leather" },
    ],
    levelOneFeatures: ["Fighting Style: Dueling", "Second Wind (1/Short Rest)"], defaultSpells: [],
  },
  Rogue: {
    id: "rogue", className: "Rogue", summary: "Precision, stealth, expertise, and a knack for finding openings.",
    primaryAbilities: ["DEX"], hitDie: 8, savingThrows: ["DEX", "INT"], skillCount: 4,
    recommendedSkills: ["Stealth", "Sleight of Hand", "Acrobatics", "Investigation"],
    skillChoices: ["Acrobatics", "Athletics", "Deception", "Insight", "Intimidation", "Investigation", "Perception", "Performance", "Persuasion", "Sleight of Hand", "Stealth"],
    recommendedAbilities: { STR: 12, DEX: 15, CON: 13, INT: 14, WIS: 10, CHA: 8 },
    equipmentPackages: [
      { id: "burglar", label: "Burglar", items: ["rapier", "shortbow", "20 arrows", "burglar's pack", "leather armor", "2 daggers", "thieves' tools"], armor: "leather" },
      { id: "delver", label: "Dungeon Delver", items: ["shortsword", "shortbow", "20 arrows", "dungeoneer's pack", "leather armor", "2 daggers", "thieves' tools"], armor: "leather" },
    ],
    levelOneFeatures: ["Expertise", "Sneak Attack (1D6)", "Thieves' Cant"], defaultSpells: [],
  },
  Cleric: {
    id: "cleric", className: "Cleric", summary: "Divine spellcraft, protection, healing, and conviction.",
    primaryAbilities: ["WIS"], hitDie: 8, savingThrows: ["WIS", "CHA"], skillCount: 2,
    recommendedSkills: ["Insight", "Religion"],
    skillChoices: ["History", "Insight", "Medicine", "Persuasion", "Religion"],
    recommendedAbilities: { STR: 14, DEX: 8, CON: 13, INT: 10, WIS: 15, CHA: 12 },
    equipmentPackages: [
      { id: "protector", label: "Protector", items: ["mace", "scale mail", "light crossbow", "20 bolts", "priest's pack", "shield", "holy symbol"], armor: "scale", shield: true },
      { id: "pilgrim", label: "Pilgrim", items: ["mace", "leather armor", "spear", "explorer's pack", "shield", "holy symbol"], armor: "leather", shield: true },
    ],
    levelOneFeatures: ["Spellcasting", "Life Domain", "Disciple of Life"],
    defaultSpells: ["Light (Cantrip)", "Sacred Flame (Cantrip)", "Thaumaturgy (Cantrip)", "Bless", "Cure Wounds", "Guiding Bolt", "Shield of Faith"],
  },
  Wizard: {
    id: "wizard", className: "Wizard", summary: "Learned arcane magic backed by a carefully kept spellbook.",
    primaryAbilities: ["INT"], hitDie: 6, savingThrows: ["INT", "WIS"], skillCount: 2,
    recommendedSkills: ["Arcana", "Investigation"],
    skillChoices: ["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"],
    recommendedAbilities: { STR: 8, DEX: 12, CON: 13, INT: 15, WIS: 14, CHA: 10 },
    equipmentPackages: [
      { id: "scholar", label: "Scholar", items: ["quarterstaff", "component pouch", "scholar's pack", "spellbook"], armor: "unarmored" },
      { id: "explorer", label: "Explorer", items: ["dagger", "arcane focus", "explorer's pack", "spellbook"], armor: "unarmored" },
    ],
    levelOneFeatures: ["Spellcasting", "Arcane Recovery (1/Day)"],
    defaultSpells: ["Light (Cantrip)", "Mage Hand (Cantrip)", "Ray of Frost (Cantrip)", "Burning Hands", "Charm Person", "Feather Fall", "Mage Armor", "Magic Missile", "Sleep"],
  },
  Druid: {
    id: "druid", className: "Druid", summary: "Nature magic, primal lore, and the promise of wild shape.",
    primaryAbilities: ["WIS"], hitDie: 8, savingThrows: ["INT", "WIS"], skillCount: 2,
    skillChoices: ["Arcana", "Animal Handling", "Insight", "Medicine", "Nature", "Perception", "Religion", "Survival"],
    recommendedSkills: ["Nature", "Perception"],
    recommendedAbilities: { STR: 10, DEX: 12, CON: 13, INT: 8, WIS: 15, CHA: 14 },
    equipmentPackages: [
      { id: "warden", label: "Warden", items: ["wooden shield", "scimitar", "leather armor", "explorer's pack", "druidic focus"], armor: "leather", shield: true },
      { id: "wanderer", label: "Wanderer", items: ["club", "quarterstaff", "leather armor", "explorer's pack", "druidic focus"], armor: "leather" },
    ],
    levelOneFeatures: ["Druidic", "Spellcasting"],
    defaultSpells: ["Druidcraft (Cantrip)", "Shillelagh (Cantrip)", "Entangle", "Faerie Fire", "Goodberry", "Healing Word"],
  },
  Monk: {
    id: "monk", className: "Monk", summary: "Discipline, speed, unarmed technique, and focused will.",
    primaryAbilities: ["DEX", "WIS"], hitDie: 8, savingThrows: ["STR", "DEX"], skillCount: 2,
    skillChoices: ["Acrobatics", "Athletics", "History", "Insight", "Religion", "Stealth"],
    recommendedSkills: ["Acrobatics", "Insight"],
    recommendedAbilities: { STR: 12, DEX: 15, CON: 13, INT: 8, WIS: 14, CHA: 10 },
    equipmentPackages: [
      { id: "traveler", label: "Traveler", items: ["shortsword", "explorer's pack", "10 darts"], armor: "monk" },
      { id: "delver", label: "Delver", items: ["quarterstaff", "dungeoneer's pack", "10 darts"], armor: "monk" },
    ],
    levelOneFeatures: ["Unarmored Defense", "Martial Arts"], defaultSpells: [],
  },
  Paladin: {
    id: "paladin", className: "Paladin", summary: "Sacred purpose expressed through armor, courage, and divine power.",
    primaryAbilities: ["STR", "CHA"], hitDie: 10, savingThrows: ["WIS", "CHA"], skillCount: 2,
    skillChoices: ["Athletics", "Insight", "Intimidation", "Medicine", "Persuasion", "Religion"],
    recommendedSkills: ["Athletics", "Persuasion"],
    recommendedAbilities: { STR: 15, DEX: 8, CON: 13, INT: 10, WIS: 12, CHA: 14 },
    equipmentPackages: [
      { id: "shield", label: "Shield Bearer", items: ["longsword", "shield", "5 javelins", "priest's pack", "chain mail", "holy symbol"], armor: "chain", shield: true },
      { id: "greatweapon", label: "Great Weapon", items: ["greatsword", "spear", "explorer's pack", "chain mail", "holy symbol"], armor: "chain" },
    ],
    levelOneFeatures: ["Divine Sense", "Lay on Hands (5 HP Pool)"], defaultSpells: [],
  },
  Ranger: {
    id: "ranger", className: "Ranger", summary: "A wilderness hunter skilled with weapons, tracking, and survival.",
    primaryAbilities: ["DEX", "WIS"], hitDie: 10, savingThrows: ["STR", "DEX"], skillCount: 3,
    skillChoices: ["Animal Handling", "Athletics", "Insight", "Investigation", "Nature", "Perception", "Stealth", "Survival"],
    recommendedSkills: ["Perception", "Stealth", "Survival"],
    recommendedAbilities: { STR: 12, DEX: 15, CON: 13, INT: 8, WIS: 14, CHA: 10 },
    equipmentPackages: [
      { id: "scout", label: "Scout", items: ["leather armor", "2 shortswords", "explorer's pack", "longbow", "20 arrows"], armor: "leather" },
      { id: "warden", label: "Warden", items: ["scale mail", "2 handaxes", "dungeoneer's pack", "longbow", "20 arrows"], armor: "scale" },
    ],
    levelOneFeatures: ["Favored Enemy", "Natural Explorer"], defaultSpells: [],
  },
  Sorcerer: {
    id: "sorcerer", className: "Sorcerer", summary: "Instinctive arcane power flowing from an extraordinary origin.",
    primaryAbilities: ["CHA"], hitDie: 6, savingThrows: ["CON", "CHA"], skillCount: 2,
    skillChoices: ["Arcana", "Deception", "Insight", "Intimidation", "Persuasion", "Religion"],
    recommendedSkills: ["Arcana", "Persuasion"],
    recommendedAbilities: { STR: 8, DEX: 14, CON: 13, INT: 10, WIS: 12, CHA: 15 },
    equipmentPackages: [
      { id: "focus", label: "Arcane Focus", items: ["light crossbow", "20 bolts", "arcane focus", "dungeoneer's pack", "2 daggers"], armor: "draconic" },
      { id: "components", label: "Components", items: ["spear", "component pouch", "explorer's pack", "2 daggers"], armor: "draconic" },
    ],
    levelOneFeatures: ["Spellcasting", "Draconic Bloodline", "Draconic Resilience"],
    defaultSpells: ["Light (Cantrip)", "Prestidigitation (Cantrip)", "Ray of Frost (Cantrip)", "Shocking Grasp (Cantrip)", "Magic Missile", "Shield"],
  },
  Warlock: {
    id: "warlock", className: "Warlock", summary: "Occult magic granted through a bargain with an otherworldly patron.",
    primaryAbilities: ["CHA"], hitDie: 8, savingThrows: ["WIS", "CHA"], skillCount: 2,
    skillChoices: ["Arcana", "Deception", "History", "Intimidation", "Investigation", "Nature", "Religion"],
    recommendedSkills: ["Arcana", "Deception"],
    recommendedAbilities: { STR: 8, DEX: 14, CON: 13, INT: 10, WIS: 12, CHA: 15 },
    equipmentPackages: [
      { id: "scholar", label: "Occult Scholar", items: ["light crossbow", "20 bolts", "component pouch", "scholar's pack", "leather armor", "spear", "2 daggers"], armor: "leather" },
      { id: "delver", label: "Occult Delver", items: ["mace", "arcane focus", "dungeoneer's pack", "leather armor", "dagger", "2 daggers"], armor: "leather" },
    ],
    levelOneFeatures: ["Otherworldly Patron: The Fiend", "Pact Magic"],
    defaultSpells: ["Chill Touch (Cantrip)", "Eldritch Blast (Cantrip)", "Charm Person", "Witch Bolt"],
  },
};

export interface SubraceRules {
  id: string;
  label: string;
  abilityBonuses?: Partial<Record<Ability, number>>;
  traits?: readonly string[];
}

export interface RaceBuildRules {
  id: string;
  raceName: RaceName;
  summary: string;
  size: "Small" | "Medium";
  speed: number;
  abilityBonuses: Partial<Record<Ability, number>>;
  abilityChoiceCount?: number;
  abilityChoiceExcluded?: readonly Ability[];
  languages: readonly string[];
  extraLanguageCount?: number;
  fixedSkills?: readonly Skill[];
  skillChoiceCount?: number;
  traits: readonly string[];
  spells?: readonly string[];
  toolProficiencies?: readonly string[];
  subraces?: readonly SubraceRules[];
}

export const RACE_BUILD_RULES: Record<RaceName, RaceBuildRules> = {
  Dwarf: {
    id: "dwarf", raceName: "Dwarf", summary: "Stout, resilient, and steeped in stonecraft.", size: "Medium", speed: 25,
    abilityBonuses: { CON: 2 }, languages: ["Common", "Dwarvish"], toolProficiencies: ["Smith's Tools"],
    traits: ["Darkvision", "Dwarven Resilience", "Dwarven Combat Training", "Stonecunning"],
    subraces: [{ id: "hill", label: "Hill Dwarf", abilityBonuses: { WIS: 1 }, traits: ["Dwarven Toughness"] }],
  },
  Elf: {
    id: "elf", raceName: "Elf", summary: "Graceful, perceptive, and touched by ancient magic.", size: "Medium", speed: 30,
    abilityBonuses: { DEX: 2 }, languages: ["Common", "Elvish"], fixedSkills: ["Perception"],
    traits: ["Darkvision", "Keen Senses", "Fey Ancestry", "Trance"],
    subraces: [{ id: "high", label: "High Elf", abilityBonuses: { INT: 1 }, traits: ["Elf Weapon Training", "High Elf Cantrip" ] }],
    spells: ["Prestidigitation (High Elf Cantrip)"],
    extraLanguageCount: 1,
  },
  Halfling: {
    id: "halfling", raceName: "Halfling", summary: "Small, nimble, brave, and uncannily lucky.", size: "Small", speed: 25,
    abilityBonuses: { DEX: 2 }, languages: ["Common", "Halfling"], traits: ["Lucky", "Brave", "Halfling Nimbleness"],
    subraces: [{ id: "lightfoot", label: "Lightfoot Halfling", abilityBonuses: { CHA: 1 }, traits: ["Naturally Stealthy"] }],
  },
  Human: {
    id: "human", raceName: "Human", summary: "Adaptable, ambitious, and broadly capable.", size: "Medium", speed: 30,
    abilityBonuses: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 }, languages: ["Common"], extraLanguageCount: 1,
    traits: ["Human Versatility"],
  },
  Dragonborn: {
    id: "dragonborn", raceName: "Dragonborn", summary: "Draconic heirs with an elemental breath weapon.", size: "Medium", speed: 30,
    abilityBonuses: { STR: 2, CHA: 1 }, languages: ["Common", "Draconic"], traits: ["Breath Weapon", "Damage Resistance"],
    subraces: [
      { id: "black", label: "Black Ancestry · Acid", traits: ["Acid Ancestry"] },
      { id: "blue", label: "Blue Ancestry · Lightning", traits: ["Lightning Ancestry"] },
      { id: "brass", label: "Brass Ancestry · Fire", traits: ["Fire Ancestry"] },
      { id: "bronze", label: "Bronze Ancestry · Lightning", traits: ["Lightning Ancestry"] },
      { id: "copper", label: "Copper Ancestry · Acid", traits: ["Acid Ancestry"] },
      { id: "gold", label: "Gold Ancestry · Fire", traits: ["Fire Ancestry"] },
      { id: "green", label: "Green Ancestry · Poison", traits: ["Poison Ancestry"] },
      { id: "red", label: "Red Ancestry · Fire", traits: ["Fire Ancestry"] },
      { id: "silver", label: "Silver Ancestry · Cold", traits: ["Cold Ancestry"] },
      { id: "white", label: "White Ancestry · Cold", traits: ["Cold Ancestry"] },
    ],
  },
  Gnome: {
    id: "gnome", raceName: "Gnome", summary: "Clever, curious, and naturally resistant to magic.", size: "Small", speed: 25,
    abilityBonuses: { INT: 2 }, languages: ["Common", "Gnomish"], traits: ["Darkvision", "Gnome Cunning"],
    subraces: [{ id: "rock", label: "Rock Gnome", abilityBonuses: { CON: 1 }, traits: ["Artificer's Lore", "Tinker"] }],
    toolProficiencies: ["Tinker's Tools"],
  },
  "Half-Elf": {
    id: "half-elf", raceName: "Half-Elf", summary: "Socially gifted and able to adapt between two worlds.", size: "Medium", speed: 30,
    abilityBonuses: { CHA: 2 }, abilityChoiceCount: 2, abilityChoiceExcluded: ["CHA"], languages: ["Common", "Elvish"], extraLanguageCount: 1,
    skillChoiceCount: 2, traits: ["Darkvision", "Fey Ancestry", "Skill Versatility"],
  },
  "Half-Orc": {
    id: "half-orc", raceName: "Half-Orc", summary: "Powerful, relentless, and intimidating.", size: "Medium", speed: 30,
    abilityBonuses: { STR: 2, CON: 1 }, languages: ["Common", "Orc"], fixedSkills: ["Intimidation"],
    traits: ["Darkvision", "Menacing", "Relentless Endurance", "Savage Attacks"],
  },
  Tiefling: {
    id: "tiefling", raceName: "Tiefling", summary: "Infernal heritage, keen intellect, and innate magic.", size: "Medium", speed: 30,
    abilityBonuses: { INT: 1, CHA: 2 }, languages: ["Common", "Infernal"],
    traits: ["Darkvision", "Hellish Resistance", "Infernal Legacy"], spells: ["Thaumaturgy (Cantrip)"],
  },
};

export interface BackgroundBuildRules {
  id: "acolyte" | "custom";
  label: string;
  fixedSkills?: readonly Skill[];
  skillChoiceCount?: number;
  languageCount: number;
  equipment: readonly string[];
  feature: string;
}

export const BACKGROUND_BUILD_RULES: Record<BackgroundBuildRules["id"], BackgroundBuildRules> = {
  acolyte: {
    id: "acolyte", label: "Acolyte", fixedSkills: ["Insight", "Religion"], languageCount: 2,
    equipment: ["holy symbol", "prayer book", "5 sticks of incense", "vestments", "common clothes", "pouch with 15 gp"],
    feature: "Shelter of the Faithful",
  },
  custom: {
    id: "custom", label: "Custom Background", skillChoiceCount: 2, languageCount: 2,
    equipment: ["holy symbol", "prayer book", "5 sticks of incense", "vestments", "common clothes", "pouch with 15 gp"],
    feature: "Custom Background Feature",
  },
};

export const LANGUAGES = [
  "Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
  "Abyssal", "Celestial", "Draconic", "Deep Speech", "Infernal", "Primordial", "Sylvan", "Undercommon",
] as const;

export function pointBuySpent(abilities: Record<Ability, number>): number {
  return Object.values(abilities).reduce((total, score) => total + (POINT_BUY_COST[score] ?? 999), 0);
}

export function classRulesById(id: string): ClassBuildRules | undefined {
  return Object.values(CLASS_BUILD_RULES).find(rules => rules.id === id);
}

export function raceRulesById(id: string): RaceBuildRules | undefined {
  return Object.values(RACE_BUILD_RULES).find(rules => rules.id === id);
}

export function backgroundRulesById(id: string): BackgroundBuildRules | undefined {
  return Object.values(BACKGROUND_BUILD_RULES).find(rules => rules.id === id);
}

export function rollAbilityScores(rng: Rng): AbilityScores {
  return Object.fromEntries(ABILITIES.map(ability => {
    const dice = [rollDie(6, rng), rollDie(6, rng), rollDie(6, rng), rollDie(6, rng)].sort((a, b) => a - b);
    return [ability, dice[1]! + dice[2]! + dice[3]!];
  })) as AbilityScores;
}

export function validateAbilityScores(abilities: AbilityScores, method: AbilityMethod): string | null {
  const scores = ABILITIES.map(ability => abilities[ability]);
  if (method === "point-buy") {
    if (scores.some(score => score < 8 || score > 15)) return "Point-buy scores must be between 8 and 15.";
    if (pointBuySpent(abilities) !== POINT_BUY_BUDGET)
      return `Ability scores must spend exactly ${POINT_BUY_BUDGET} point-buy points.`;
  } else if (method === "standard") {
    const expected = [...STANDARD_ARRAY].sort((a, b) => a - b).join(",");
    if ([...scores].sort((a, b) => a - b).join(",") !== expected)
      return "Standard-array scores must use 15, 14, 13, 12, 10, and 8 exactly once.";
  } else if (scores.some(score => score < 3 || score > 18)) {
    return "Rolled scores must be between 3 and 18 before racial increases.";
  }
  return null;
}

export interface CharacterBuildChoices {
  classRules: ClassBuildRules;
  raceRules: RaceBuildRules;
  subraceId?: string | null;
  abilityMethod: AbilityMethod;
  abilities: AbilityScores;
  racialAbilityChoices: Ability[];
  classSkills: Skill[];
  racialSkills: Skill[];
  backgroundRules: BackgroundBuildRules;
  backgroundName: string;
  backgroundSkills: Skill[];
  alignment: Alignment;
  personalityTraits: string[];
  ideal: string;
  bond: string;
  flaw: string;
  extraLanguages: string[];
  equipmentPackageId: string;
}

function selectedSubrace(race: RaceBuildRules, id?: string | null): SubraceRules | undefined {
  return race.subraces?.find(subrace => subrace.id === id);
}

export function validateBuildChoices(choices: CharacterBuildChoices): string | null {
  const abilityError = validateAbilityScores(choices.abilities, choices.abilityMethod);
  if (abilityError) return abilityError;
  const { classRules, raceRules, backgroundRules } = choices;
  if (raceRules.subraces?.length && !selectedSubrace(raceRules, choices.subraceId))
    return `Choose a ${raceRules.raceName} lineage.`;
  if (new Set(choices.racialAbilityChoices).size !== (raceRules.abilityChoiceCount ?? 0))
    return `${raceRules.raceName} must choose ${raceRules.abilityChoiceCount ?? 0} flexible ability increases.`;
  if (choices.racialAbilityChoices.some(a => raceRules.abilityChoiceExcluded?.includes(a)))
    return `${raceRules.raceName} cannot apply a flexible increase to that ability.`;
  if (new Set(choices.classSkills).size !== classRules.skillCount || choices.classSkills.length !== classRules.skillCount)
    return `${classRules.className} must choose exactly ${classRules.skillCount} class skill proficiencies.`;
  if (choices.classSkills.some(skill => !classRules.skillChoices.includes(skill)))
    return `One or more selected skills are not available to ${classRules.className}.`;
  if (new Set(choices.racialSkills).size !== (raceRules.skillChoiceCount ?? 0))
    return `${raceRules.raceName} must choose ${raceRules.skillChoiceCount ?? 0} skill proficiencies.`;
  const backgroundSkills = backgroundRules.fixedSkills ?? choices.backgroundSkills;
  if (backgroundRules.skillChoiceCount && new Set(backgroundSkills).size !== backgroundRules.skillChoiceCount)
    return "A custom background must choose exactly two skill proficiencies.";
  const allSkills = [...(raceRules.fixedSkills ?? []), ...choices.racialSkills, ...choices.classSkills, ...backgroundSkills];
  if (new Set(allSkills).size !== allSkills.length)
    return "Skill proficiencies from race, class, and background cannot overlap; choose a replacement.";
  const languageCount = (raceRules.extraLanguageCount ?? 0) + backgroundRules.languageCount;
  if (new Set(choices.extraLanguages).size !== languageCount || choices.extraLanguages.length !== languageCount)
    return `Choose exactly ${languageCount} additional languages.`;
  if (choices.extraLanguages.some(language => raceRules.languages.includes(language)))
    return "Choose additional languages you do not already know.";
  if (!classRules.equipmentPackages.some(pack => pack.id === choices.equipmentPackageId))
    return "Choose a legal starting equipment package.";
  if (!choices.backgroundName.trim()) return "Choose a background name.";
  return null;
}

export function validateCharacterChoices(
  rules: ClassBuildRules,
  abilities: Record<Ability, number>,
  proficientSkills: Skill[],
): string | null {
  if (pointBuySpent(abilities) !== POINT_BUY_BUDGET)
    return `Ability scores must spend exactly ${POINT_BUY_BUDGET} point-buy points.`;
  if (new Set(proficientSkills).size !== rules.skillCount || proficientSkills.length !== rules.skillCount)
    return `${rules.className} must choose exactly ${rules.skillCount} class skill proficiencies.`;
  if (proficientSkills.some(skill => !rules.skillChoices.includes(skill)))
    return `One or more selected skills are not available to ${rules.className}.`;
  return null;
}

export function applyRacialBonuses(
  abilities: AbilityScores,
  raceRules: RaceBuildRules,
  subraceId: string | null | undefined,
  flexibleChoices: Ability[],
): Record<Ability, number> {
  const result = { ...abilities } as Record<Ability, number>;
  const subrace = selectedSubrace(raceRules, subraceId);
  for (const bonuses of [raceRules.abilityBonuses, subrace?.abilityBonuses ?? {}])
    for (const ability of ABILITIES) result[ability] += bonuses[ability] ?? 0;
  for (const ability of flexibleChoices) result[ability] += 1;
  return result;
}

function armorClass(pack: EquipmentPackage, abilities: Record<Ability, number>): number {
  const dex = abilityModifier(abilities.DEX);
  const base = pack.armor === "chain" ? 16
    : pack.armor === "scale" ? 14 + Math.min(2, dex)
    : pack.armor === "leather" ? 11 + dex
    : pack.armor === "barbarian" ? 10 + dex + abilityModifier(abilities.CON)
    : pack.armor === "monk" ? 10 + dex + abilityModifier(abilities.WIS)
    : pack.armor === "draconic" ? 13 + dex
    : 10 + dex;
  return base + (pack.shield ? 2 : 0);
}

export function buildLevelOneCharacter(
  id: string,
  name: string,
  choices: CharacterBuildChoices,
): Character {
  const error = validateBuildChoices(choices);
  if (error) throw new Error(error);
  const subrace = selectedSubrace(choices.raceRules, choices.subraceId);
  const abilities = applyRacialBonuses(
    choices.abilities, choices.raceRules, choices.subraceId, choices.racialAbilityChoices,
  );
  const backgroundSkills = choices.backgroundRules.fixedSkills ?? choices.backgroundSkills;
  const proficientSkills = [
    ...(choices.raceRules.fixedSkills ?? []), ...choices.racialSkills,
    ...choices.classSkills, ...backgroundSkills,
  ];
  const pack = choices.classRules.equipmentPackages.find(item => item.id === choices.equipmentPackageId)!;
  const raceTraits = [...choices.raceRules.traits, ...(subrace?.traits ?? [])];
  const maxHp = choices.classRules.hitDie + abilityModifier(abilities.CON)
    + (raceTraits.includes("Dwarven Toughness") ? 1 : 0);
  return {
    id, name, sex: "male", age: "adult", bio: "", className: choices.classRules.className,
    raceName: choices.raceRules.raceName, subrace: subrace?.label ?? null,
    background: choices.backgroundName.trim(), alignment: choices.alignment,
    personalityTraits: choices.personalityTraits.filter(Boolean).slice(0, 2),
    ideal: choices.ideal, bond: choices.bond, flaw: choices.flaw,
    level: 1, abilities, proficientSkills, savingThrowProficiencies: [...choices.classRules.savingThrows],
    proficiencyBonus: 2, maxHp, hp: maxHp, ac: armorClass(pack, abilities),
    inventory: [...pack.items, ...choices.backgroundRules.equipment], portraitUrl: null,
    languages: [...choices.raceRules.languages, ...choices.extraLanguages],
    toolProficiencies: [...(choices.raceRules.toolProficiencies ?? [])],
    traits: [...raceTraits, choices.backgroundRules.feature], speed: choices.raceRules.speed,
    classFeatures: [...choices.classRules.levelOneFeatures],
    spells: [...(choices.raceRules.spells ?? []), ...choices.classRules.defaultSpells],
    size: choices.raceRules.size,
  };
}

export function buildLevelThreeCharacter(
  id: string,
  name: string,
  rules: ClassBuildRules,
  abilities: Record<Ability, number>,
  proficientSkills: Skill[],
): Character {
  const con = abilityModifier(abilities.CON);
  const maxHp = rules.hitDie + con + 2 * (Math.floor(rules.hitDie / 2) + 1 + con);
  const dex = abilityModifier(abilities.DEX);
  const ac = rules.className === "Fighter" ? 18
    : rules.className === "Cleric" ? 16 + Math.min(2, dex)
    : rules.className === "Rogue" ? 11 + dex
    : 10 + dex;
  return {
    id, name, sex: "male", age: "adult", bio: "", className: rules.className,
    raceName: "Human", subrace: null, background: "Acolyte", alignment: "Neutral",
    personalityTraits: [], ideal: "", bond: "", flaw: "", level: 3,
    abilities: { ...abilities }, proficientSkills: [...proficientSkills], proficiencyBonus: 2,
    savingThrowProficiencies: [...rules.savingThrows], languages: ["Common"], toolProficiencies: [],
    traits: [], classFeatures: [...rules.levelOneFeatures], spells: [...rules.defaultSpells],
    speed: 30, size: "Medium", maxHp, hp: maxHp, ac,
    inventory: [...rules.equipmentPackages[0]!.items], portraitUrl: null,
  };
}

// Defaults remain useful to tests, scripted clients, and backward-compatible joins.
export const PREGEN_CHARACTERS: Character[] = Object.values(CLASS_BUILD_RULES).map(rules =>
  buildLevelThreeCharacter(
    rules.id,
    rules.className,
    rules,
    rules.recommendedAbilities,
    [...rules.recommendedSkills],
  ),
);
