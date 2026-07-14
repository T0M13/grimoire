# 11 — Ideas backlog (player-voiced, 2026-07-14)

Captured from playtesting feedback. These are wanted features, not commitments; when one is
picked up, spec it against `docs/06-open-world-multiplayer.md` (parallel dialogue and quest
scopes are already partially designed there).

## Click-to-talk: private NPC dialogues

- Scene occupants (the NPC/creature portraits under "In This Scene") become **clickable**.
- Clicking one opens a **dialogue mode** with that character: their portrait large, their own
  voice, their personality — a 1:1 conversation like a Baldur's Gate dialogue screen.
- **Private to the player who clicked.** Other online players stay in the scene and do not see
  or hear the conversation; at most the table sees "Kael is talking to Marla."
- Exit dialogue → back to the shared scene. Information learned is the player's to share or keep.
- Builds directly on what exists: occupants list, per-NPC persistent voices/portraits, and the
  Speak intent. Missing piece: per-connection (not broadcast) narration/audio channels — specced
  in docs/06 as "recipient-scoped feeds".

## Interactable scenes: clickable items

- Scenes list interactable **objects** (chest, bookshelf, strange rune, abandoned cart) the same
  way they list occupants. Clicking one = a built-in "examine/search/use" action.
- The DM decides object contents when first touched; contents persist on the scene afterwards.
- Searching a pointed-at object is FREE (no roll); rolls only for trapped/locked/guarded objects.
- Data model: `scene.objects[]` parallel to `scene.occupants[]`, with a small interaction menu.

## Autosave slots

- Beyond the continuous write-through save, keep **rolling autosave snapshots** (e.g. every 10
  minutes and on every scene change, keep the last 5) in the existing saves table, named
  "Autosave — <scene> — <time>". Protects against bad story turns, not just crashes.

## Deeper relationships and adult table controls

- The foundation now persists per-hero NPC trust, affection, status, and one established note with
  fixed server reducers. Expand it into favors/debts, factions, jealousy, gifts, long memories, and
  relationship-specific quests without accepting model-authored numbers.
- Add host-only per-topic lines/veils and a session-zero consent screen. The current Standard/Mature
  switch is table-wide but not host-authorized because seats/lobby roles do not exist yet.
- Keep romance adult, mutual, slowly earned, and fade-to-black. Explicit sexual narration, coercion,
  sexual violence, minors, and sexualized captivity are intentionally not backlog items.
- Creative capture/interrogation is playable now through general deterministic checks. Full 2014 SRD
  combat capture needs initiative, attacks, grapple/shove, conditions, escape, and restraint in the
  Phase 4 encounter engine; do not fake those mechanics in narration.

## Per-player async progression ("play on while others are offline")

- Every player owns their hero (real seat identity/token, not just a name claim).
- A player can connect alone and **continue from where THEY are**: their own current scene and
  position, moving through the shared world at their own pace.
- **Online players cannot interact with offline players** — offline heroes are simply "not here"
  (written out softly by the DM).
- **Main quest is shared**: progress made by whoever plays advances the table's main quest.
  Side quests are personal, but completing one grants a smaller reward to everyone
  ("Kael cleared the cellar — the party earns part of the bounty").
- Requires: seat tokens, per-player scene position, per-connection feeds, and quest scopes
  (main/shared vs side/personal) — the docs/06 architecture is the foundation.

## Smaller voiced wishes (already partially done, keep true)

- Exploration should mostly be roll-free; dice for real gambles only (fixed 2026-07-14).
- Campaign premises must vary run-to-run — no more whisper/market clichés (seeded openings,
  fixed 2026-07-14).
- Chat/story column stays centered when side panels open.
- A journey chooser appears before character creation, and the party roster shows live
  join/rejoin/offline and current shared-turn activity (fixed 2026-07-14).
