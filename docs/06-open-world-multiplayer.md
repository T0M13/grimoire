# 06 — Open-World Multiplayer and Parallel Dialogue

This document records the intended evolution from one shared story turn into a persistent,
text-first open world where players may split up, speak to different NPCs, pursue separate goals,
and still experience important events together.

## Player experience

- Every player has a **Current Activity**: exploring, traveling, talking, fighting, resting, or
  waiting. Activities belong to a location and may contain one player, a subgroup, or the party.
- NPC conversations open as dialogue threads. A player can talk privately while another searches
  a room or visits a different district. Nearby players can join a conversation explicitly.
- A location feed shows local public actions. Private dialogue and secret actions remain visible
  only to their participants and the authoritative DM process.
- Material events—an alarm bell, an explosion, combat beginning, a city gate closing—become
  **World Events**. Everyone affected sees a banner, hears the shared narration, and receives the
  resulting state change even when they were in separate activities.
- The journal has **Personal**, **Party**, and **World** quest scopes. Objectives update from
  deterministic event handlers, never from unvalidated narration text.

## Narration viewpoints

Narration is rendered for a recipient, not stored as one universally relative paragraph:

- The active character sees and hears themselves as **you/your**.
- Other participating characters are named.
- A shared event has one canonical fact record, then recipient-specific narration can describe
  those same facts from each player's location and knowledge.
- Table-wide audio is reserved for shared events. Private dialogue audio exists only in the tabs
  of participating players.

The current shared log remains suitable for solo play and party-wide beats. Before parallel
activities ship, log entries need `scope`, `participants`, `locationId`, and `eventId` fields.

## Authoritative model

```text
Player Intent
    ↓
Activity Queue ── validates location, participants, and locks
    ↓
Rules / World Reducer ── commits canonical facts and quest transitions
    ↓
Event Bus
    ├── private activity event → participants only
    ├── location event → everyone present
    └── world event → every affected player
    ↓
Recipient-Aware Narration + UI State
```

The LLM proposes intent and narration; code owns time, inventory, movement, NPC availability,
quest flags, combat, and event visibility. Each activity reads a world revision and commits with
optimistic concurrency. Conflicting actions are retried against the new state or rejected with an
in-world explanation.

## Persistence additions

Planned tables/entities:

- `locations`: stable identity, exits, occupants, local facts, current visual asset.
- `activities`: type, participants, location, status, created/updated world revisions.
- `conversations`: NPC, participants, visibility, transcript, NPC disposition snapshot.
- `world_events`: canonical payload, scope, affected locations/players, world timestamp.
- `quests` and `quest_objectives`: owner scope, prerequisites, state, event-driven transitions.
- `player_knowledge`: facts and quest clues a character is allowed to see.
- `visual_shots`: location/activity composition prompt, seed, image asset, continuity metadata.

## Scene and dialogue art

- A location owns a stable establishing image cached from location identity plus composition.
- Dialogue may request a cached **shot** of the same location with the speaking NPC foregrounded.
- NPC appearance descriptions are stored once and reused in every prompt. Generated seeds and
  prompts are persisted so revisiting the dialogue reuses the same image.
- Player likeness consistency should later use portrait reference conditioning; names alone are
  never expected to produce a consistent face.
- Art remains asynchronous and never blocks text or voice.

## Delivery slices

1. Add quest/event journal UI with personal/party/world scopes on the current shared room.
2. Add stable locations, occupants, and location-scoped public feeds.
3. Add private NPC conversation activities and recipient-scoped messages/audio.
4. Allow non-conflicting activities to resolve concurrently with revision checks.
5. Promote material activity outcomes into shared world events.
6. Add persistent dialogue shots and portrait-reference character continuity.

Combat initially forces affected participants into one shared activity. Players elsewhere may
continue unless the event logically interrupts them. This keeps concurrency understandable while
preserving one authoritative world.
