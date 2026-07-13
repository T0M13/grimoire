import { SKILL_ABILITY, type Ability, type Character, type CheckRequest, type RollResult, type Skill } from "@grimoire/shared";

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
  const critical = die === 20 ? "success" : die === 1 ? "failure" : "none";
  const success = critical === "success" ? true : critical === "failure" ? false : total >= check.dc;
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

export function applyDamage(character: Character, amount: number): Character {
  return { ...character, hp: Math.max(0, character.hp - Math.max(0, amount)) };
}

export function heal(character: Character, amount: number): Character {
  return { ...character, hp: Math.min(character.maxHp, character.hp + Math.max(0, amount)) };
}

// ---------- SRD 5.1 character creation ----------

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export interface ClassBuildRules {
  id: "fighter" | "rogue" | "cleric" | "wizard";
  className: Character["className"];
  hitDie: 6 | 8 | 10;
  savingThrows: readonly Ability[];
  skillChoices: readonly Skill[];
  skillCount: number;
  recommendedSkills: readonly Skill[];
  recommendedAbilities: Record<Ability, number>;
  starterEquipment: readonly string[];
}

export const CLASS_BUILD_RULES: Record<Character["className"], ClassBuildRules> = {
  Fighter: {
    id: "fighter", className: "Fighter", hitDie: 10, savingThrows: ["STR", "CON"], skillCount: 2,
    recommendedSkills: ["Athletics", "Perception"],
    skillChoices: ["Acrobatics", "Animal Handling", "Athletics", "History", "Insight", "Intimidation", "Perception", "Survival"],
    recommendedAbilities: { STR: 15, DEX: 14, CON: 13, INT: 8, WIS: 10, CHA: 12 },
    starterEquipment: ["chain mail", "longsword", "shield", "light crossbow", "20 bolts", "explorer's pack"],
  },
  Rogue: {
    id: "rogue", className: "Rogue", hitDie: 8, savingThrows: ["DEX", "INT"], skillCount: 4,
    recommendedSkills: ["Stealth", "Sleight of Hand", "Acrobatics", "Investigation"],
    skillChoices: ["Acrobatics", "Athletics", "Deception", "Insight", "Intimidation", "Investigation", "Perception", "Performance", "Persuasion", "Sleight of Hand", "Stealth"],
    recommendedAbilities: { STR: 12, DEX: 15, CON: 13, INT: 14, WIS: 10, CHA: 8 },
    starterEquipment: ["rapier", "shortbow", "20 arrows", "burglar's pack", "leather armor", "2 daggers", "thieves' tools"],
  },
  Cleric: {
    id: "cleric", className: "Cleric", hitDie: 8, savingThrows: ["WIS", "CHA"], skillCount: 2,
    recommendedSkills: ["Insight", "Religion"],
    skillChoices: ["History", "Insight", "Medicine", "Persuasion", "Religion"],
    recommendedAbilities: { STR: 14, DEX: 8, CON: 13, INT: 10, WIS: 15, CHA: 12 },
    starterEquipment: ["mace", "scale mail", "light crossbow", "20 bolts", "priest's pack", "shield", "holy symbol"],
  },
  Wizard: {
    id: "wizard", className: "Wizard", hitDie: 6, savingThrows: ["INT", "WIS"], skillCount: 2,
    recommendedSkills: ["Arcana", "Investigation"],
    skillChoices: ["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"],
    recommendedAbilities: { STR: 8, DEX: 12, CON: 13, INT: 15, WIS: 14, CHA: 10 },
    starterEquipment: ["quarterstaff", "component pouch", "scholar's pack", "spellbook"],
  },
};

export function pointBuySpent(abilities: Record<Ability, number>): number {
  return Object.values(abilities).reduce((total, score) => total + (POINT_BUY_COST[score] ?? 999), 0);
}

export function classRulesById(id: string): ClassBuildRules | undefined {
  return Object.values(CLASS_BUILD_RULES).find(rules => rules.id === id);
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
    id, name, sex: "male", age: "adult", bio: "", className: rules.className, level: 3,
    abilities: { ...abilities }, proficientSkills: [...proficientSkills], proficiencyBonus: 2,
    maxHp, hp: maxHp, ac, inventory: [...rules.starterEquipment], portraitUrl: null,
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
