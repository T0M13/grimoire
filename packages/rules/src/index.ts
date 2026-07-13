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

// ---------- Pregenerated SRD-style level-3 party (MVP character select) ----------

function makeCharacter(
  id: string,
  name: string,
  className: Character["className"],
  abilities: Record<Ability, number>,
  proficientSkills: Skill[],
  maxHp: number,
  ac: number,
  inventory: string[],
): Character {
  return {
    id, name, sex: "male", age: "adult", bio: "", className, level: 3,
    abilities, proficientSkills, proficiencyBonus: 2,
    maxHp, hp: maxHp, ac, inventory, portraitUrl: null,
  };
}

export const PREGEN_CHARACTERS: Character[] = [
  makeCharacter("fighter", "Fighter", "Fighter",
    { STR: 16, DEX: 12, CON: 15, INT: 10, WIS: 12, CHA: 10 },
    ["Athletics", "Intimidation", "Perception"],
    28, 17, ["longsword", "shield", "chain mail", "torch", "rations"]),
  makeCharacter("rogue", "Rogue", "Rogue",
    { STR: 10, DEX: 16, CON: 12, INT: 13, WIS: 12, CHA: 14 },
    ["Stealth", "Sleight of Hand", "Acrobatics", "Deception", "Perception"],
    21, 14, ["shortsword", "dagger", "thieves' tools", "hooded lantern"]),
  makeCharacter("cleric", "Cleric", "Cleric",
    { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 16, CHA: 12 },
    ["Insight", "Medicine", "Religion", "Persuasion"],
    24, 16, ["mace", "shield", "holy symbol", "healer's kit"]),
  makeCharacter("wizard", "Wizard", "Wizard",
    { STR: 8, DEX: 14, CON: 13, INT: 16, WIS: 12, CHA: 10 },
    ["Arcana", "History", "Investigation", "Insight"],
    17, 12, ["quarterstaff", "spellbook", "component pouch", "ink and quill"]),
];
