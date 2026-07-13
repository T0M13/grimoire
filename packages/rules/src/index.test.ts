import { describe, expect, it } from "vitest";
import {
  BACKGROUND_BUILD_RULES, RACE_BUILD_RULES, abilityModifier, applyDamage,
  buildLevelOneCharacter, buildLevelThreeCharacter, checkRequestFromIntent,
  CLASS_BUILD_RULES, d20, heal, POINT_BUY_BUDGET, PREGEN_CHARACTERS, pointBuySpent,
  resolveCheck, roll, rollAbilityScores, rollDie, seededRng, skillModifier,
  validateAbilityScores, validateBuildChoices, validateCharacterChoices,
} from "./index.js";
import type { CheckRequest } from "@grimoire/shared";

const rogue = PREGEN_CHARACTERS.find(c => c.id === "rogue")!;

describe("seededRng", () => {
  it("is deterministic for a given seed", () => {
    const a = seededRng(42), b = seededRng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it("produces values in [0, 1)", () => {
    const rng = seededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("rollDie", () => {
  it("stays within bounds and hits both extremes over many rolls", () => {
    const rng = seededRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rollDie(20, rng);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      seen.add(v);
    }
    expect(seen.size).toBe(20);
  });
  it("rejects invalid dice", () => {
    expect(() => rollDie(1, seededRng(1))).toThrow();
    expect(() => rollDie(2.5, seededRng(1))).toThrow();
  });
});

describe("roll (notation)", () => {
  it("parses NdM+K", () => {
    const r = roll("2d6+3", seededRng(3));
    expect(r.rolls).toHaveLength(2);
    expect(r.modifier).toBe(3);
    expect(r.total).toBe(r.rolls[0]! + r.rolls[1]! + 3);
  });
  it("parses dM and NdM-K", () => {
    expect(roll("d20", seededRng(1)).rolls).toHaveLength(1);
    const r = roll("3d4-2", seededRng(9));
    expect(r.modifier).toBe(-2);
    expect(r.total).toBe(r.rolls.reduce((a, b) => a + b, 0) - 2);
  });
  it("rejects garbage", () => {
    for (const bad of ["", "banana", "0d6", "2d", "d", "101d6", "2d6+", "1e5"])
      expect(() => roll(bad, seededRng(1)), bad).toThrow();
  });
});

describe("abilityModifier", () => {
  it("matches the 5e table", () => {
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(20)).toBe(5);
  });
});

describe("skillModifier", () => {
  it("adds proficiency only when proficient", () => {
    // rogue: DEX 15 (+2), proficient in Stealth (+2 prof) = +4
    expect(skillModifier(rogue, "Stealth")).toBe(4);
    // rogue: WIS 10 (+0), not proficient in Survival = +0
    expect(skillModifier(rogue, "Survival")).toBe(0);
  });
});

describe("d20 advantage/disadvantage", () => {
  it("advantage takes max, disadvantage takes min", () => {
    for (let seed = 0; seed < 50; seed++) {
      const adv = d20(seededRng(seed), "advantage");
      expect(adv.die).toBe(Math.max(...adv.raw));
      const dis = d20(seededRng(seed), "disadvantage");
      expect(dis.die).toBe(Math.min(...dis.raw));
    }
  });
});

describe("resolveCheck", () => {
  const check: CheckRequest = { playerName: "Kira", skill: "Stealth", dc: 12, reason: "sneak past the guard" };

  it("computes total = die + modifier and compares to DC", () => {
    for (let seed = 0; seed < 200; seed++) {
      const r = resolveCheck(rogue, check, seededRng(seed));
      expect(r.total).toBe(r.die + r.modifier);
      expect(r.modifier).toBe(4);
      if (r.critical === "none") expect(r.success).toBe(r.total >= 12);
    }
  });

  it("does not treat natural 1 or 20 as automatic on an ability check", () => {
    let saw20 = false, saw1 = false;
    for (let seed = 0; seed < 500 && !(saw20 && saw1); seed++) {
      const r = resolveCheck(rogue, { ...check, dc: 30 }, seededRng(seed));
      if (r.die === 20) { expect(r.success).toBe(false); expect(r.critical).toBe("none"); saw20 = true; }
      const r2 = resolveCheck(rogue, { ...check, dc: 5 }, seededRng(seed));
      if (r2.die === 1) { expect(r2.success).toBe(true); expect(r2.critical).toBe("none"); saw1 = true; }
    }
    expect(saw20).toBe(true);
    expect(saw1).toBe(true);
  });
});

describe("damage & healing", () => {
  it("clamps at 0 and maxHp and never mutates the input", () => {
    const hurt = applyDamage(rogue, 9999);
    expect(hurt.hp).toBe(0);
    expect(rogue.hp).toBe(rogue.maxHp); // untouched
    const healed = heal(hurt, 9999);
    expect(healed.hp).toBe(rogue.maxHp);
    expect(applyDamage(rogue, -5).hp).toBe(rogue.hp); // negative damage is ignored
  });
});

describe("pregen party", () => {
  it("all pregens are internally consistent", () => {
    for (const c of PREGEN_CHARACTERS) {
      expect(c.hp).toBe(c.maxHp);
      expect(c.level).toBe(3);
      expect(c.proficiencyBonus).toBe(2);
      expect(Object.keys(c.abilities)).toHaveLength(6);
    }
  });
});

describe("SRD point-buy character creation", () => {
  it("uses the official 27-point budget for every class recommendation", () => {
    for (const rules of Object.values(CLASS_BUILD_RULES))
      expect(pointBuySpent(rules.recommendedAbilities)).toBe(POINT_BUY_BUDGET);
  });

  it("rejects overspent abilities and wrong class skill choices", () => {
    const rules = CLASS_BUILD_RULES.Wizard;
    expect(validateCharacterChoices(rules, { ...rules.recommendedAbilities, CHA: 15 }, ["Arcana", "History"]))
      .toContain("27");
    expect(validateCharacterChoices(rules, rules.recommendedAbilities, ["Athletics", "History"]))
      .toContain("not available");
  });

  it("derives level-three HP, AC, skills, and starter equipment from mechanics", () => {
    const rules = CLASS_BUILD_RULES.Wizard;
    const wizard = buildLevelThreeCharacter("id", "Cedric", rules, rules.recommendedAbilities, ["Arcana", "Investigation"]);
    expect(wizard.maxHp).toBe(17);
    expect(wizard.ac).toBe(11);
    expect(wizard.proficientSkills).toEqual(["Arcana", "Investigation"]);
    expect(wizard.inventory).toContain("spellbook");
  });
});

describe("complete SRD level-one character creation", () => {
  const choices = {
    classRules: CLASS_BUILD_RULES.Fighter,
    raceRules: RACE_BUILD_RULES.Human,
    subraceId: null,
    abilityMethod: "standard" as const,
    abilities: CLASS_BUILD_RULES.Fighter.recommendedAbilities,
    racialAbilityChoices: [],
    classSkills: ["Athletics", "Perception"] as const,
    racialSkills: [] as const,
    backgroundRules: BACKGROUND_BUILD_RULES.acolyte,
    backgroundName: "Acolyte",
    backgroundSkills: [] as const,
    alignment: "Neutral Good" as const,
    personalityTraits: ["I keep my word."], ideal: "Duty", bond: "My village", flaw: "Stubborn",
    extraLanguages: ["Dwarvish", "Elvish", "Giant"],
    equipmentPackageId: "guardian",
  };

  it("validates every dependent choice and derives the authoritative sheet", () => {
    expect(validateBuildChoices({ ...choices, classSkills: [...choices.classSkills], racialSkills: [], backgroundSkills: [] })).toBeNull();
    const fighter = buildLevelOneCharacter("id", "Mara", {
      ...choices, classSkills: [...choices.classSkills], racialSkills: [], backgroundSkills: [],
    });
    expect(fighter.level).toBe(1);
    expect(fighter.raceName).toBe("Human");
    expect(fighter.abilities.STR).toBe(16);
    expect(fighter.maxHp).toBe(12);
    expect(fighter.ac).toBe(18);
    expect(fighter.proficientSkills).toEqual(["Athletics", "Perception", "Insight", "Religion"]);
    expect(fighter.languages).toEqual(["Common", "Dwarvish", "Elvish", "Giant"]);
  });

  it("supports all official ability methods", () => {
    expect(validateAbilityScores(CLASS_BUILD_RULES.Wizard.recommendedAbilities, "standard")).toBeNull();
    expect(validateAbilityScores(CLASS_BUILD_RULES.Wizard.recommendedAbilities, "point-buy")).toBeNull();
    const rolled = rollAbilityScores(seededRng(42));
    expect(validateAbilityScores(rolled, "rolled")).toBeNull();
    expect(Object.values(rolled).every(score => score >= 3 && score <= 18)).toBe(true);
  });

  it("maps narrative difficulty categories to fixed SRD DCs", () => {
    expect(checkRequestFromIntent({ playerName: "Mara", skill: "Athletics", difficulty: "very_easy", reason: "climb" }).dc).toBe(5);
    expect(checkRequestFromIntent({ playerName: "Mara", skill: "Athletics", difficulty: "moderate", reason: "climb" }).dc).toBe(15);
    expect(checkRequestFromIntent({ playerName: "Mara", skill: "Athletics", difficulty: "nearly_impossible", reason: "climb" }).dc).toBe(30);
  });
});
