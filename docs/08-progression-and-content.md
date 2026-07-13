# 08 — Progression, NPC Voices, and Content Systems

Last updated: 2026-07-13

This document turns the latest playtest ideas into implementation boundaries. It is a delivery
plan, not a claim that advancement or complete combat already exists.

## Shipped foundation

- Act, Speak, and Ask DM are separate validated player intents.
- Speak requires structured NPC identity. Named NPCs keep a persisted Kokoro voice selected from
  a sex-specific pool with personality descriptors influencing the stable choice.
- Ask DM produces a labeled direct answer and cannot move the player or advance time by itself.
- Main/side quests persist and transition through structured start/advance/complete/fail intents.
- Inventory displays grouped item cards with code-native category icons.

NPC voice playback is currently shared-room audio. Private conversation audio must wait for the
recipient-scoped activity work in `06-open-world-multiplayer.md`.

## Advancement contract

D&D 5e has no generic fifteen-point skill allocation during play. Advancement must follow SRD
class tables and character level:

1. The server awards deterministic experience or a milestone event.
2. Crossing a legal threshold creates `pendingLevelUp`; narration cannot directly change level.
3. The player may keep playing or open a compact level-up drawer.
4. Code lists only choices required at that class level: class feature options, spells, Expertise,
   Ability Score Improvement, or another SRD-defined choice.
5. The server validates the full choice object, applies HP/proficiency/features/resources, writes
   SQLite, and then emits a level-up event for narration and presentation.

Ability Score Improvement must enforce its legal budget and score cap. It is not available at
every level and must never be confused with skill proficiency. Multiclassing and feats remain
separate future scopes.

## Delivery order

1. Add SRD experience thresholds, class-level feature tables, and pure advancement reducers/tests.
2. Add persisted `experience`, `pendingLevelUp`, hit dice/resources, and migration defaults.
3. Implement Fighter levels 1–3 as the narrow vertical slice, including HP and Action Surge.
4. Add the reusable level-up drawer and reconnect-safe pending choices.
5. Expand all twelve classes, then ASIs, spell progression, and the remaining level-1 selectors.
6. Only then let structured quest/combat events award XP or milestones.

## Inventory and icons

Replace raw item strings with authoritative entities only after migration support exists:

```text
ItemStack { definitionId, name, category, quantity, weight, equipped, description, artKey? }
```

Keep common UI icons as small inline SVGs: they clone instantly, stay consistent, and need no LFS.
Optional hand-painted unique/magic-item art may later be generated offline as compressed WebP,
keyed by `artKey`, cached, and loaded asynchronously. Use Git LFS only if tracked binary art becomes
large enough to justify the extra clone dependency; the basic game must not require it.

## Quest spine and failure

One active main quest is the campaign spine. Side quests may branch freely. A failed check must
respect the roll while producing a cost, danger, lost opportunity, changed relationship, or alternate
route—not a narrative dead end. Quest completion and rewards remain structured server events; prose
can describe them but cannot mutate mechanics.
