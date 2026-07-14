# 05 — Project handoff

Last updated: 2026-07-14

This is the fast orientation document for the next developer or AI working on Grimoire. Read
the design documents for product intent; use this file for the exact implemented state.

## Current state

Phase 1 is a playable local-first vertical slice. A player can create a level-1 hero through the
six-step 2014 SRD flow using all nine SRD races and all twelve classes; standard array, point buy,
or rolled abilities; legal skills, background, languages, equipment, features, and default spells.
The creator is split into compact tabs and can randomize a complete legal build. A player can then
generate a custom portrait, begin
a campaign, act through free text or suggestions, make deterministic skill checks, hear streamed
Kokoro narration, see asynchronous scene art, inspect character sheets, and resume from SQLite.
After the first browser gesture, a procedural soundtrack follows location, scene mood, time, and
weather, rotates through longer-scene movements, and reacts to choices, location changes, checks,
results, combat, and system events.

The game supports multiple browser clients on one authoritative, sequential WebSocket room. It is
not yet the Phase 3 lobby/activity system: there is one shared location, one global DM lock, public
dialogue/audio, name-only reconnect identity, and no host authorization or private conversations.
The saved party roster now has separate transient online/activity presence, so every tab can see
who is Ready, Acting, Speaking, Asking DM, Rolling, Following, or Offline. This does not make actions
parallel: the first accepted action still owns the shared Storyteller beat until it resolves.

### How the current co-op room plays

- Outside combat there is no round-robin turn order. Any joined player may submit when `dmBusy` is
  false; the first accepted intent resolves completely before another can begin.
- Every tab receives the same authoritative scene, log, quests, streamed narration, NPC dialogue,
  images, dice results, and table voice. Actor-relative narration calls the acting hero "you", but
  that same rendered text/audio is currently broadcast to everyone.
- A pending check pauses the room and only the named hero may roll.
- Main and side quests are currently party-shared. Personal side quests, private conversations,
  per-player locations, and non-conflicting parallel activities remain the next multiplayer slice
  described in `docs/06-open-world-multiplayer.md`.

## Implemented features

- React/Vite/Tailwind client with reconnect-safe identity in browser local storage.
- Pre-character journey gate with New Journey, Load Saved Journey, and a multiplayer-safe Join
  Current Journey path. New/load operations are table-wide, confirmed in the UI, and acknowledged
  by the server before character creation opens. An unjoined socket may replace only a pristine
  table; once a journey is active, a joined party member must use Settings.
- `CharacterCreator.tsx`: compact Race → Class → Abilities → Details → Equipment → Review tabs.
- All twelve SRD classes and nine races, SRD lineages, three ability methods, class/racial/background
  skills, languages, traits, level-1 features/default spells, legal equipment packages, and derived
  HP/AC; the server rebuilds and rejects mechanically invalid sheets.
- Background portrait generation with a `?` placeholder until the image is ready.
- Active-player narration viewpoint: the storyteller addresses the character as "you/your" and
  solo openings cannot describe the player as accompanying their own character. A streaming and
  persistence scrubber prevents private visual/occupant labels from reaching player-facing prose.
- Plain-language narration uses short direct sentences, few modifiers, and no decorative metaphors.
- Clickable party badges and a character-sheet dock for every party member. Map, Quests, and
  Settings use the same non-modal dock while the action composer remains usable.
- Live party presence is a transient WebSocket feed rather than save data. A new hero joining enters
  the shared system log; reconnect/offline churn does not pollute saves. Multiple tabs attached to
  one hero count as one online player.
- Constrained two-pass AI DM: structured move selection, then streamed narration.
- Deterministic rules engine for dice, skill checks, damage, and healing; ability checks correctly
  do not auto-succeed/fail on natural 20/1. The model chooses a named difficulty category and code
  maps it to the SRD DC scale. Exact coverage is in `docs/07-srd-rules-coverage.md`.
- Async ComfyUI living-subject-free environment art with policy-versioned composition caching,
  legacy figure-clause filtering, full-signature stale-result guards, and crossfade presentation.
- Structured scene occupants for named people and creatures. Each receives a hashed, style-specific
  close-up portrait asynchronously; dialogue rows and the visible-scene rail show `?` until ready.
- Kokoro CUDA narration using `bm_fable` (male) and `af_heart` (female).
- Per-tab mute, volume, and pause/resume. Muting cuts the current sentence immediately.
- Per-tab Web Audio soundscape covering all 12 scene moods with three restrained movements each. A stable scene
  hash picks the opening movement; location kind, time, and weather modify it; long scenes rotate
  every 150 seconds. Crossfades, combat/boss arrangements, gameplay cues, and independent persisted
  music/effects controls remain asset-free and browser-local.
- Table-wide narrator selection persisted in campaign state.
- Explicit Act, Speak, and Ask DM intent modes. Speak requires a substantive direct NPC response;
  Ask DM yields a labeled out-of-character Storyteller/DM answer without advancing time.
- Named NPCs receive a campaign-persistent Kokoro voice distinct from the narrator. Sex and
  personality choose a stable voice and bounded delivery rate; social-check reactions retain both.
  American and British pronunciation pipelines share one model, so this does not add VRAM residency.
- Settings has a shared Standard/Mature content mode. Standard is the default. The toggling player
  is warned to obtain table agreement; no vote or host enforcement exists yet. Mature only permits
  player-requested dark humor, brief fictional gore, and slowly earned adult consensual romance;
  intimacy fades to black. Explicit sexual description,
  minors, coercion, sexual violence, and eroticized captivity remain excluded. New Game resets the
  content mode to Standard; a same-party New Campaign preserves it and saves restore it.
- NPC relationships persist per hero as trust, affection, status, and a short established note.
  The model selects a fixed event, never numbers; server reducers apply/clamp values. Check-dependent
  changes wait for the real dice result; unresolved success/failure branches are persisted for crash
  recovery but redacted from every client snapshot. Mutual romance requires Mature mode, an adult/elder hero,
  an NPC explicitly marked adult, an existing bond, a person (not creature), and mutual interest.
  Current relationship state appears under visible NPCs and in that hero's Sheet drawer.
- Structured quest start/advance/complete/fail events, one opening main quest fallback, and a Quest
  Journal with active/completed/failed presentation.
- Inventory sheet cards group duplicates and use code-native category icons without binary assets.
- Scene Map drawer with the authoritative current location, exits, main objective, and visible
  occupants. It deliberately does not claim to be the still-planned persistent region graph.
- Continuous SQLite campaign persistence plus named host-local save/load/delete slots.
- Disconnect autosave. Closing/disconnecting the final browser also aborts in-flight TTS.
- Cross-platform host supervisor with per-service logs and automatic cleanup 15 seconds after
  the final browser disconnects; reconnecting during the grace period cancels shutdown.
- Linux server mode binds the web UI/game API for remote clients while keeping model sidecars
  private on loopback; persistent mode and a systemd unit template support always-on hosts.
- New-game flow that keeps named saves and the selected narrator available.
- Parallel NPC dialogue, scoped quests/events, and persistent dialogue-shot architecture is
  specified in `docs/06-open-world-multiplayer.md`; implementation remains Phase 3 work.

## DM model policy (2026-07-14, benchmarked)

`spikes/model-shootout.mjs` compares candidate DM models on TTFT, tok/s, constrained-JSON
validity, and check-selection. Results on the reference RTX 4070: llama3.1:8b (80 tok/s,
0.89 s tool calls, valid JSON) beat qwen3:8b (77 tok/s but 1.85 s tool calls and never chose
request_check); llama3.2:3b (110 tok/s, valid JSON, strong check bias) is the low-tier pick.
Setup detects VRAM and writes `var/host-config.json`: >= 7 GB VRAM -> `llama3.1:8b`, otherwise
`llama3.2:3b` (CPU-friendly). `config.ts` resolves `GRIMOIRE_DM_MODEL` env > host-config >
default. Re-run the shootout before changing tiers; do not swap models on vibes.

## Public API and autoplay

The WebSocket protocol is the public API (`docs/09-api.md`). `tools/api/autoplay.mjs`
(`npm run demo`) joins as a bot and plays autonomously for N minutes — use it as a host
health check and as the harness for AI-driven playtesting. A 1-minute reference run produced
15 beats, 6 rolls, and 4 scene changes with no stalls.

## Fresh-clone setup

Windows hosts run `./start.ps1`. It invokes the idempotent `setup.ps1` before launching anything.
The bootstrap installs missing prerequisites through winget, runs `npm ci`, clones the tested
ComfyUI revision, creates the shared ComfyUI/Kokoro virtual environment, downloads DreamShaper 8
and LCM-LoRA, starts Ollama, and pulls `llama3.1:8b`. Expensive steps are skipped after success.

Run `./setup.ps1 -Check` for a read-only readiness report. The first setup needs a stable internet
connection, roughly 10 GB of free disk space, and several minutes for model downloads. The target
host is Windows 11 with an NVIDIA RTX 4070 12 GB; CPU narration remains possible but slower.

Once Node/npm exists, the cross-platform convenience commands are `npm start`,
`npm run start:persistent`, and `npm stop`. `tools/host/start.mjs` dispatches to the existing
PowerShell or Bash launcher, so it does not duplicate lifecycle logic.

Linux hosts run `./start.sh`; use `./start.sh --persistent` for an always-on server. `setup.sh`
supports Debian/Ubuntu, Fedora, and Arch-family distributions on x86-64 and ARM64, provisions a
local Node.js 22 runtime if necessary, and otherwise mirrors the Windows bootstrap. It selects
CUDA 12.6 PyTorch when NVIDIA is detected and CPU wheels otherwise; override with
`GRIMOIRE_TORCH_INDEX_URL`. `deploy/grimoire.service` is a systemd template whose user/path must
be adapted after running setup once. The application has no built-in authentication or TLS, so
remote access should be through a trusted LAN/VPN or an authenticated HTTPS reverse proxy.
For split-origin proxy deployments, `VITE_GAME_ORIGIN=https://game.example.com` controls the
client's HTTPS/WSS game endpoint. `GRIMOIRE_BIND_HOST` restricts the default `0.0.0.0` listeners.
The defaults are web `5173`, game `8787`, narrator `8765`, ComfyUI `8188`, and Ollama `11434`;
`GRIMOIRE_GAME_PORT` and `GRIMOIRE_TTS_PORT` override the two Grimoire-owned backend ports.

Downloaded runtimes, model weights, databases, generated media, and setup markers are excluded
from Git. They live under `vendor/` and `var/` and are reproducible or machine-local.

## Code map

- `packages/shared/src/index.ts`: Zod schemas, public state, and wire protocol. Change this first.
- `packages/rules/src/index.ts`: pure deterministic game mechanics. No I/O or LLM calls.
- `packages/server/src/game.ts`: authoritative room, lifecycle, turns, persistence, saves, media.
- `packages/server/src/dm.ts`: prompt assembly and two-pass orchestration.
- `packages/server/src/media.ts`: scene/portrait ComfyUI workflows and streamed TTS helpers.
- `packages/server/src/db.ts`: SQLite write-through campaign, event log, and save slots.
- `packages/client/src/useGame.ts`: WebSocket/reconnect state and narration audio engine.
- `packages/client/src/useSoundscape.ts`: tab-local music/SFX graph, mood profiles, cue routing,
  deterministic scene/time/weather selection, movement rotation, persisted controls, first-gesture
  unlock, and page-close cleanup.
- `packages/shared/src/index.ts`: also owns interaction modes, NPC speaker/profile, quest update,
  quest state, and live narration-speaker contracts.
- `packages/client/src/CharacterCreator.tsx`: guided SRD creator and final-sheet review.
- `packages/client/src/App.tsx`: game screen, character sheet, and settings UI (the retired creator
  remains temporarily as unreachable code and should be removed during the next UI extraction).
- `setup.ps1` / `setup.sh`: reproducible Windows/Linux runtime and model bootstraps.
- `start.ps1` / `start.sh`: one-command launchers; `--persistent` is the Linux server mode.
- `stop.ps1` / `stop.sh`: authenticated localhost shutdown with process-tree fallback.
- `tools/host/supervisor.mjs`: cross-platform process ownership, logs, and lifecycle cleanup.
- `tools/host/stop.mjs`: shared graceful-stop and forced process-tree fallback.
- `deploy/grimoire.service`: example persistent Linux systemd service.

## Persistence and control boundaries

- `var/grimoire.db` is authoritative and is saved after resolved turns and client disconnects.
- `var/assets/` holds generated scene, portrait, and narration files.
- Named saves are snapshots in the same host-local SQLite database, not cloud saves.
- Narrator, music, and effects controls are per browser profile (`localStorage`). Narrator sex and
  scene mood are table-wide authoritative state. Sound is rendered only in each open browser tab.
- Clients send validated intents only. The server owns mechanics and mutable campaign state.

## Validation

Before handing off a change:

```powershell
npm test
npm run typecheck
./setup.ps1 -Check
# Linux: ./setup.sh --check
```

For live-stack changes, also run `node spikes/e2e-smoke.mjs` and manually test the relevant UI.
For scene/portrait changes, `npm run smoke:visual` generates an isolated environment, person, and
creature asset under `var/assets/img/` without touching the active campaign.

Current manual regression checklist:

- With browser identity cleared, confirm the journey chooser appears before character creation.
  Test New Journey, Load Saved Journey, Back To Journeys, and Join Current Journey from a second
  isolated browser without resetting the active table.
- Visit every creator tab, randomize a character, review the level-1 sheet, join, see `?`, then see
  the generated portrait. On a short viewport, confirm Details scrolls from the heading through all
  background skills and languages to the navigation buttons.
- Open your own and another party member's sheet, then type and submit with the dock still open.
  Repeat with Map, Quests, and Settings; on mobile, scroll the dock without covering the composer.
- Switch narrator sex and verify the next sentence uses the selected voice.
- During narration: pause, resume, change volume, then mute mid-sentence.
- In Settings, independently mute and adjust music/effects; confirm the quieter mix sits behind
  narration and the Now Playing label matches the scene, time, and weather; wait for or temporarily shorten the movement interval and confirm a
  same-scene variation; verify choices, rolls, combat, and boss arrangements.
- In Settings, switch from Standard to Mature and confirm the shared-table warning. In a second
  isolated browser profile, confirm the same setting arrives; New Game must reset it to Standard.
- Speak with the same named adult NPC over several meaningful helpful/personal beats. Confirm only
  the acting hero's Sheet gains relationship entries and the visible NPC card shows the status.
- Ask to capture an alert resisting enemy. Confirm the Storyteller permits the attempt but pauses
  for an appropriate real check; failure must change the situation instead of blocking the quest.
- With Mature enabled, explicitly request dark humor or a gory fictional beat and confirm it stays
  brief. Romance must grow gradually and mutually; intimacy must fade to black. Standard mode must
  not introduce those mature beats.
- Use Speak with two different NPCs, then revisit the first; verify direct replies, distinct voices,
  stable voice/rate reuse, `?` → close-up portrait, and style-specific portrait reuse. Repeat with one
  named creature. Storyteller narration must never receive an avatar.
- Start or resume the current save and confirm no prose contains private labels such as
  `Visible living subjects`, `scene occupants`, `image prompt`, or portrait instructions.
- Confirm freshly painted scenes contain no people, faces, animals, or monsters, including an old
  save whose stored image prompt mentioned a figure. Open Map and exercise every current exit.
- Multiplayer: use two isolated browser profiles, join two different heroes, verify both converge
  on the same party/scene, both see new-character join events, and party badges show Acting versus
  Following in both tabs. Confirm Offline/Online transitions do not add story-log entries, only the
  named hero can roll, and one tab closing leaves the other alive. Open two tabs for one hero and
  confirm closing only one does not mark that hero Offline.
- Open Quests and verify the opening main quest; inspect duplicate inventory item grouping/icons.
- Create a named save, start a new game, load the save, and verify hero/story/voice restoration.
- Close the final browser during narration; verify audio stops and reopening restores state.

## Pacing and presentation contract (2026-07-14 playtest feedback)

These behaviors were tuned after real play sessions and must be preserved:

- **The story never stalls.** When a player states a decision ("I go through the portal"), the DM
  executes it that beat. `MOVE_INSTRUCTION` marks movement intent as mandatory `change_scene`
  ("MOVEMENT IS SACRED"), and `dm-system.md` forbids lingering on decided moments. A location is
  worth 2-3 beats of description at most.
- **Beats are short.** 1-3 sentences, single-sentence beats encouraged, `num_predict: 180` caps the
  hard ceiling. Language stays simple; no purple prose. Written for players who may not speak
  English natively; plain text only (the sanitizer also strips markdown symbols defensively).
- **Quest text is beginner-simple.** Title = 2-4 everyday words; objective = one sentence starting
  with a verb that says exactly what to do; summary = one plain sentence of why. Enforced in the
  move-instruction prompt and mirrored by the hardcoded opening-quest fallback ("The First Clue").
  Abstract phrasing like "investigate the immediate hook" is explicitly banned.
- **Rolls are for gambles, exploration is free (rebalanced 2026-07-14 after playtests).**
  A check needs real opposition/danger/time pressure AND an interesting failure. Looking,
  listening, reading, examining pointed-at objects, and searching safe places never roll; clues
  needed for story progress are given freely. No re-rolling the same failed attempt. Check
  outcomes may bend the story.
- **Openings are seeded.** `onNewCampaign` rolls a random place/threat/hidden-twist seed
  (SEED_PLACES/THREATS/TWISTS in game.ts) unless players give a premise, and bans the model's
  pet cliches (whispers, market stalls, hooded strangers). Player-voiced feature wishes live in
  `docs/11-ideas-backlog.md` (click-to-talk private dialogues, clickable scene items, autosaves,
  per-player async progression).
- **Stale narration is skipped.** A new player action or roll click calls `cancelAudio(true)`:
  in-flight TTS aborts, queued sentences drop, clients get `audio_stop`, and the narrator starts
  fresh with the new beat. Players who read faster than the narrator never wait for old audio.
- **Scene art is quality-first and contains no living subjects.** Scene backgrounds use the
  dpmpp_2m/karras 24-step sampler asynchronously. Positive prompts are reduced to environment and
  story evidence; negative prompts ban people, faces, figures, animals, and monsters. Named people
  and creatures use dedicated 512px close-up portraits. Cache signatures are policy-versioned and
  include location, context, art style, and composition so old bad assets regenerate automatically.
- **Art style is a table setting** (`PublicState.artStyle`, `set_art_style` message, Settings
  drawer): `painting` (classical oils, the default), `sketch` (aged ink illustration on
  parchment, like plates from an old tome), or `cinematic`. Style prompts live in
  `CONFIG.sceneStyles`; switching repaints the current scene and each style caches separately.
- **The pre-adventure Fireside is cozy on purpose** (warm hearth, armchairs, blankets, snowy
  window) — it is the menu-screen mood, not an adventure scene.

Regression additions for this contract: say "I go through the [door/portal/gate]" and verify the
very next beat is a new scene; act mid-narration and verify the narrator cuts over to the new
response; verify most non-trivial attempts request a roll.

## Next product work

The roadmap remains authoritative. The most immediate incomplete Phase 1/2 items are compact
selectors for remaining level-1 class/spell choices, the broader SRD data import, starter scene-art
pregeneration, an optional authored music library, a persistent region graph, and 3D dice.
Full SRD advancement and encounter mechanics are specified in `docs/08-progression-and-content.md`;
the current narrator must never grant levels, ASIs, class features, or item mechanics through prose.
The current capture flow uses the deterministic ability-check engine; full SRD initiative, attacks,
grapple/shove, conditions, escape, and restraint remain Phase 4 and must not be described as implemented.
Do not confuse these planned features with defects in the current vertical slice.
