# 07 — 2014 SRD rules coverage

Last audited: 2026-07-13

Grimoire implements the 2014 fifth-edition rules from Wizards of the Coast's Creative Commons
System Reference Document 5.1. The D&D Beyond Basic Rules are useful for reading and navigation,
but repository data and prompts must stay inside the CC-licensed SRD boundary. Do not copy prose
from D&D Beyond or the Player's Handbook.

Primary references:

- [D&D Beyond: 2014 Basic Rules character steps](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/step-by-step-characters)
- [Wizards of the Coast: SRD 5.1 CC PDF](https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf)
- [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

## Character-creation contract

New heroes begin at level 1 and follow the source order:

1. Race
2. Class
3. Ability scores
4. Description and background
5. Equipment
6. Come together / review

The client may recommend or randomize choices, but it never creates the final sheet. The client
sends choices; `packages/server/src/game.ts` reconstructs and validates them through
`packages/rules/src/index.ts`. Only that server-built character enters campaign state.

## Implemented now

| Area | Coverage |
|---|---|
| Race | Nine SRD races; Hill Dwarf, High Elf, Lightfoot Halfling, and Rock Gnome; all ten Dragonborn ancestries; 2014 ability increases, size, speed, languages, fixed skill traits, and concise trait labels |
| Class | All twelve SRD classes; hit die, saving throws, legal class skill lists/counts, level-1 feature labels, and legal default spell selections |
| Ability scores | Standard array, 27-point buy, and rolled 4d6-drop-lowest; racial increases apply after the base array |
| Background | SRD Acolyte plus the SRD custom-background path; background skills, extra languages, feature, gear, personality traits, ideal, bond, and flaw |
| Equipment | Two compact, legal SRD starting packages per class; derived level-1 HP and armor class account for armor, shield, unarmored defense, Draconic Resilience, Constitution, Dexterity, and Dwarven Toughness |
| Sheet | Race/lineage, background, alignment, six abilities, saves, all skills, HP, AC, speed, hit die, traits, class features, spells, languages, tools, equipment, and story flavor |
| Checks | Ability/skill modifiers and proficiency are deterministic; named difficulty maps to DC 5/10/15/20/25/30; natural 1/20 have no automatic effect on ability checks |
| Quest state | Structured campaign objectives persist and update through validated DM intents; quest prose itself grants no mechanics |

## Deliberately not represented as complete

- The SRD exposes only one sample background and a limited set of subraces. Non-SRD Player's
  Handbook backgrounds/subraces are not copied into this public repository.
- Equipment is presented as two legal packages per class rather than every weapon-by-weapon
  permutation. Coin-buy creation is not implemented.
- Required level-1 class decisions such as fighting-style alternatives, Expertise targets,
  Favored Enemy, Natural Explorer, individual cantrip/spell selection, and prepared-spell changes
  currently use documented legal defaults. Dedicated compact selectors are future work.
- The deterministic engine currently adjudicates ability checks, dice, damage, and healing.
  Initiative, attacks, spell effects, rests, conditions, death saves, resources, encounters, and
  advancement remain Phase 4/5 work. Until code implements a mechanic, narration must not mutate it
  or claim that Grimoire has rules-complete combat.
- Advancement is not implemented. The model cannot award a level, increase an ability, unlock a
  feature, or alter proficiency. D&D 5e does not use a generic pool of skill points: later ASIs,
  proficiency/expertise choices, class features, and spells must occur only at their legal levels.

## LLM boundary

The narrator receives an authoritative character block containing race, class, level, abilities,
proficiencies, traits, features, spells, equipment, and current state. It may request a structured
skill check and classify its difficulty. It may not roll, calculate a DC, change HP, invent a known
spell, add an item through prose, or override a resolved result. Prompts improve behavior, but code
and schema validation are the guarantee; never describe prompt text alone as rules enforcement.

## Adding rules safely

1. Confirm the mechanic exists in SRD 5.1 CC, not merely on a D&D Beyond/PHB page.
2. Add concise facts/data, not copied descriptive prose.
3. Add or change shared schemas before server/client behavior.
4. Resolve the mechanic deterministically in `packages/rules` with seeded tests.
5. Let the LLM emit only a constrained intent; validate it and apply state on the server.
6. Update this matrix and the handoff with the exact new boundary.
