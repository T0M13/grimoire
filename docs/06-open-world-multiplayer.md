# 06 — Open-World Multiplayer and Parallel Dialogue

This document records the intended evolution from one shared story turn into a persistent,
text-first open world where players may split up, speak to different NPCs, pursue separate goals,
and still experience important events together.

## Current shared-room behavior

The shipped room is shared co-op, not the parallel system below:

- The saved `party` is the full campaign roster. A separate transient presence feed marks each hero
  Ready, Acting, Speaking, Asking DM, Rolling, Following, or Offline. New heroes create a public
  join event; connection churn stays transient and never enters a save slot.
- Outside combat there is no fixed player order, but the room is sequential: the first action sent
  while the Storyteller is idle takes the global `dmBusy` lock until its full beat resolves.
- Every connected tab receives the same scene, log, quest journal, narration, NPC dialogue, audio,
  art, and dice result. Actor-relative narration says "you" to the acting hero, but it is not yet
  rendered separately for the other recipients.
- A pending check blocks new actions and only the named hero can roll.
- All current quests and conversations are party-public. Private side quests, separate locations,
  and simultaneous activities require the recipient/location/activity model specified below.

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

The shared-room foundation now distinguishes **Act**, **Speak**, and **Ask DM**. Speak creates a
direct labeled NPC beat, and named NPCs keep a persisted voice profile across conversations.
This is not private dialogue yet: all current-room clients still receive the same text and audio.
Scenes now also carry up to eight structured visible people/creatures and render their separate
portraits, but occupancy can currently change only with a scene move or a direct conversation.

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

- A location owns a stable **living-subject-free** establishing image cached from location identity
  plus composition. Architecture, terrain, lighting, and physical evidence carry the story.
- Named people and creatures own style-specific close-up portraits. The client composes those cards
  beside dialogue and in the visible-scene rail; the storyteller never receives an avatar.
- NPC appearance descriptions are stored once and reused. Portrait cache signatures include name,
  type, voice-family sex, appearance, personality, art style, and policy version.
- A later dialogue-shot system may combine a location plate and portrait reference, but must not
  ask an unconditioned scene model to redraw tiny, inconsistent faces.
- Player likeness consistency should later use portrait reference conditioning; names alone are
  never expected to produce a consistent face.
- Art remains asynchronous and never blocks text or voice.

## Map evolution

The shipped Scene Map is intentionally local: it centers the current scene and arranges its known
exit labels around it, with the active main objective and visible occupants. It is useful on mobile
but is not a discovered-world graph.

The authoritative region-map slice should add server-owned nodes and exits:

```text
WorldMap { currentLocationId, locations: Record<LocationId, LocationNode> }
LocationNode { id, name, kind, x, y, visited, exits, presentNpcIds, questIds }
WorldExit { id, label, toLocationId?, state: open|locked|unknown, oneWay }
```

Code creates IDs, graph links, exit state, and persistent SVG coordinates; the LLM supplies flavor,
never identity or topology. Exit buttons then send a structured `exitId` rather than prose. Split
party work later replaces the single current location with per-character/activity locations without
discarding the graph.

## Delivery slices

1. Add roster presence and quest/event journal UI on the current shared room. **Transient party
   presence and the party quest foundation are complete**;
   personal/world scopes and deterministic world-event triggers remain.
2. Add stable location IDs/graph exits, authoritative occupants, and location-scoped public feeds.
3. Add private NPC conversation activities and recipient-scoped messages/audio.
4. Allow non-conflicting activities to resolve concurrently with revision checks.
5. Promote material activity outcomes into shared world events.
6. Add persistent dialogue shots and portrait-reference character continuity.

Combat initially forces affected participants into one shared activity. Players elsewhere may
continue unless the event logically interrupts them. This keeps concurrency understandable while
preserving one authoritative world.
