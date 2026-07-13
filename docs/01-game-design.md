# 01 — Game Design Document

## 1. What the player experiences

You open a link in your browser. A title screen with painted-fantasy art. You pick your saved
character (or build one in a guided flow). Your friends' portraits pop in as they join the lobby.
The host presses **Begin Session**.

The screen fades to a generated painting of a rain-soaked tavern. Warm lute music fades in.
A deep Storyteller voice reads, while the same text types out on screen:

> *"The Gilded Griffin smells of wet wool and spiced wine. Behind the bar, Marla eyes the
> stranger in the corner — the one who hasn't touched his drink since you walked in..."*

Below the scene: your party's portraits, HP rings, and a text box. You type *"I walk over and
sit across from the stranger"* — or click one of 3 suggested actions. The DM responds within a
second, streaming. When a check is needed, a big **"Roll Insight (DC 13)"** button appears only
for you; you click, 3D dice tumble across the screen, everyone sees your 17, and the story
continues based on the result.

That's the whole game. Everything below is in service of that moment-to-moment feel.

## 2. Game modes / party size

- **Solo (1 player):** identical experience; DM may offer a companion NPC the AI plays.
- **Co-op (2–6 players):** host runs the server; others join via invite link. Drop-in/drop-out
  mid-session is supported (absent PCs fade to "background" — the DM writes them out softly).
- There is **no human DM role**. The tool *is* the DM. (A "DM override console" for the host is
  a later nice-to-have: nudge the story, retcon, adjust difficulty.)

## 3. The core loop (out of combat)

```
Storyteller narrates scene  →  players act (free text OR suggested actions OR move)
      ↑                                              ↓
State saved  ←  DM narrates outcome  ←  rules engine resolves (maybe: dice roll request)
```

Key rules of the loop:

- **Free text is always allowed.** Suggested actions (3 max) exist to help newer players and
  keep pacing snappy, never to railroad.
- **Spotlight system for multiplayer pacing:** out of combat there are no strict turns. Anyone
  can act; the DM weaves simultaneous intents into one beat. If one player has acted 3+ times
  in a row while others are idle, the DM explicitly turns to another player ("Kira, while he
  argues with the barkeep — you notice..."). This is a prompt-level rule, cheap and effective.
- **Dice are player-owned.** The DM never rolls *for* a player. A roll request locks to the
  relevant player(s) with a visible DC (or hidden DC for deception-type checks). Party members
  see each other's rolls — shared drama is the point.
- **The DM asks, the engine answers.** The LLM emits a structured action like
  `request_check(player, skill, dc)` or `deal_damage(target, "2d6+3", type)`. The server
  resolves it deterministically and feeds the result back for narration.

## 4. Movement & maps

Grid-and-token movement (Roll20 style) is the wrong shape for an AI-narrated game — it's slow,
fiddly on the web, and fights the storyteller. Instead, **two layers**:

### 4.1 Scene graph ("where can we go") — primary
The world is a graph of **locations** (tavern → market square → north gate → forest road...).
The UI shows the current scene art with **clickable exits/POIs** (doors, roads, the mysterious
stranger) rendered as labeled hotspots, plus a small region map (stylized, node-based — think
Slay the Spire / 80 Days) for travel. Moving = clicking a node or typing "we head to the docks".
The DM generates new nodes on the fly as the story expands and they persist in the world state.

This is fast, touch-friendly, trivially multiplayer-syncable, and matches theater-of-the-mind.

### 4.2 Tactical view (combat only) — simple, optional
Combat uses an abstract **zone map**: 3–6 named zones (e.g., "bar", "overturned tables",
"doorway") drawn as simple cards/areas with tokens for combatants. Moving = drag your token to
a zone (movement speed → how many zones per turn). Range/AoE rules map onto zones
(melee = same zone, ranged = any zone, AoE = everyone in a zone). This keeps 5e tactics
meaningful without pathfinding, walls, or a grid renderer. A true grid mode can come much later
if we ever want it.

## 5. Combat

- **Initiative:** rolled automatically (visible), turn order shown as a tracker rail.
- **On your turn:** action buttons generated from your sheet (weapon attacks, prepared spells,
  dash/dodge/help, improvise-freetext). Improvised actions go through the LLM → mapped to a
  rules resolution (ability check / attack with disadvantage / etc.).
- **All math is engine-side:** attack rolls vs AC, saves, damage dice, conditions, death saves,
  concentration. The LLM receives the mechanical outcome and narrates it vividly.
- **Enemies:** SRD monster stat blocks (imported dataset). The DM picks *tactically simple but
  flavorful* behavior via a lightweight behavior policy (focus low-HP? protect the shaman?)
  suggested by the LLM but validated by the engine (must be a legal action).
- **Balance:** encounters are built by the engine using the SRD encounter-budget math (party
  level × size → XP budget → monster selection filtered by environment/story tags the LLM
  provides). The LLM proposes the *fiction* ("bandits with a trained wolf"), the engine ensures
  the numbers are a fair Medium/Hard encounter. Difficulty setting per campaign (Story / Normal
  / Deadly).
- **Pace target:** a full combat round for a 4-player party should take < 3 minutes.

## 6. The Storyteller (voice + presentation)

- Every DM narration is spoken by a local TTS **narrator voice** (and typed out in sync).
  Sentence-streamed: audio of sentence 1 plays while sentence 2 is still generating.
- NPC dialogue can use 2–4 alternate voices (male/female/gravelly/regal) chosen by the DM via
  a `voice` tag on dialogue lines. Skippable/muteable per player.
- Text is always shown — voice is atmosphere, not a requirement (accessibility + players on mute).

## 7. Scene presentation (no cutscenes — everything live)

There is **no cutscene system and no separate presentation state**. The game never takes
control away from players or makes them watch something before they can act. Instead, the
presentation layer reacts *during* play:

- **Scene art** is generated async and the game **never waits for it**: narration streams over
  the current image and new art simply crossfades in behind the text when ready (target
  2–8 s), with a slow Ken Burns drift so the screen always feels alive.
- **Dramatic beats** (boss reveal, death, level-up, chapter turn) get *emphasis*, not
  interruption: a music sting, a slightly bolder narration style, maybe a brief vignette
  darkening — input stays available the whole time.
- **Session start:** a short spoken "previously on..." recap plays over the last scene's art
  while players are already free to look at their sheets and act.
- **Image caching by scene composition signature** (location identity/type + time + weather +
  mood + prompt hash): revisiting the same shot reuses art, while a materially different NPC
  interaction can receive a distinct cached composition. Ship with a pre-generated starter
  library (~100 common scenes) so even session one feels instant.
- Consistent art style via a locked style prompt (and later a style LoRA); characters get
  portrait art generated once at creation, then reused everywhere.

## 8. Music & sound

- **No live music generation** (too slow / VRAM-hungry). Instead: a **mood-tagged library**
  pre-generated offline with ACE-Step (already running locally) — tavern, travel, forest,
  dungeon, tension, combat, boss, sorrow, victory, mystery, town, night. ~3–5 tracks per mood,
  loopable, crossfaded on mood change. The DM emits `set_mood("combat_boss")` as a tool call.
- SFX one-shots (dice, sword hit, level-up chime, door creak) from a small static library.
- New moods/tracks can be batch-generated between sessions — never during play.

## 9. Story generation & memory

- **Fresh every time, but structured.** Campaign start: players pick a *premise card*
  (genre/tone/region seed) or "surprise us". The DM generates a campaign skeleton — a secret
  outline of 3–5 arcs with villains, fronts, and stakes — hidden from players, persisted, and
  *revised* as players go off-script. This gives improvisation a spine (no aimless wandering).
- **Beat-based pacing:** the DM plans one "beat" ahead (scene goal, obstacles, secrets, what
  each NPC wants). Beats are small enough to regenerate instantly when players zig.
- **Memory layers:**
  1. Hot context: current scene + last N exchanges (verbatim).
  2. Campaign state: structured JSON — party, inventory, quests, NPCs met (with attitude),
     locations discovered, world facts, promises made. Always in the prompt, always current.
  3. Long-term: per-session summaries + a vector store of events for "remember that innkeeper
     from session 2?" recall.
- **Session recap:** "Previously on..." cutscene auto-generated from the last session summary.

## 10. Characters & saves

- The live first slice has four SRD classes, 27-point-buy abilities, legal class skill choices,
  starter equipment, and auto-derived level-3 HP/AC/saves. The next builder slice adds species,
  backgrounds, languages, equipment alternatives, class features, and spell selection.
- The full 5e sheet is stored server-side; players see a clean tabbed sheet UI
  (Stats / Inventory / Spells / Notes). Level-ups are guided ceremonies with a cutscene.
- Characters are reusable across campaigns. Everything (campaign, world, log, images metadata)
  is saved continuously — closing the browser loses nothing; "load campaign" resumes mid-scene.

## 11. Multiplayer & session UX details

- Lobby with invite link/code; host can mark seats as "closed" for smaller parties.
- Reconnect-safe: refreshing the page rejoins seamlessly (state lives on the server).
- Per-player private whispers to the DM ("I secretly pocket the gem") — DM narrates publicly
  only what others would perceive.
- Vote-to-skip for long narrations; per-player TTS volume; text-size options.
- Host controls: pause, save & end session, kick, difficulty, content-safety level.

## 12. Tone & safety

Campaign setup includes content preferences (violence level, horror, romance: fade-to-black,
lines & veils list). These are injected into the DM system prompt and enforced.

## 13. What this game is NOT (scope guards)

- Not a VTT (no grid maps, fog of war, module imports).
- Not a full 5e implementation — **SRD subset** done *correctly* beats everything done loosely.
- Not video generation. Not live music generation. Not voice *input* (v1; nice later).
- Not cutscene-driven — no moment where players must watch instead of play.
- Not cloud/multi-tenant. One host, one party, LAN/tunnel access.
