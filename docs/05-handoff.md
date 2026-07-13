# 05 — Project handoff

Last updated: 2026-07-13

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
After the first browser gesture, a procedural soundtrack follows scene mood and sound cues react
to choices, location changes, checks, results, combat, and system events.

The game supports multiple browser clients on one authoritative WebSocket room, but the full
multiplayer lobby/seat/spotlight feature set remains Phase 3 work.

## Implemented features

- React/Vite/Tailwind client with reconnect-safe identity in browser local storage.
- `CharacterCreator.tsx`: compact Race → Class → Abilities → Details → Equipment → Review tabs.
- All twelve SRD classes and nine races, SRD lineages, three ability methods, class/racial/background
  skills, languages, traits, level-1 features/default spells, legal equipment packages, and derived
  HP/AC; the server rebuilds and rejects mechanically invalid sheets.
- Background portrait generation with a `?` placeholder until the image is ready.
- Active-player narration viewpoint: the storyteller addresses the character as "you/your" and
  solo openings cannot describe the player as accompanying their own character.
- Clickable party badges and a character-sheet drawer for every party member.
- Constrained two-pass AI DM: structured move selection, then streamed narration.
- Deterministic rules engine for dice, skill checks, damage, and healing; ability checks correctly
  do not auto-succeed/fail on natural 20/1. The model chooses a named difficulty category and code
  maps it to the SRD DC scale. Exact coverage is in `docs/07-srd-rules-coverage.md`.
- Async ComfyUI scene art with composition-aware caching and crossfade presentation. Prompts
  specify indoor/outdoor context, visible NPCs, and their physical action in the current hook.
- Kokoro CUDA narration using `bm_fable` (male) and `af_heart` (female).
- Per-tab mute, volume, and pause/resume. Muting cuts the current sentence immediately.
- Per-tab Web Audio soundscape covering all 12 scene moods with crossfades, percussive combat/boss
  arrangements, and synthesized UI/choice/scene/roll/result/event cues. Music and effects each
  have their own persisted mute/volume controls; no audio assets or server-side player are needed.
- Table-wide narrator selection persisted in campaign state.
- Continuous SQLite campaign persistence plus named host-local save/load/delete slots.
- Disconnect autosave. Closing/disconnecting the final browser also aborts in-flight TTS.
- Cross-platform host supervisor with per-service logs and automatic cleanup 15 seconds after
  the final browser disconnects; reconnecting during the grace period cancels shutdown.
- Linux server mode binds the web UI/game API for remote clients while keeping model sidecars
  private on loopback; persistent mode and a systemd unit template support always-on hosts.
- New-game flow that keeps named saves and the selected narrator available.
- Parallel NPC dialogue, scoped quests/events, and persistent dialogue-shot architecture is
  specified in `docs/06-open-world-multiplayer.md`; implementation remains Phase 3 work.

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
  persisted controls, first-gesture unlock, and page-close cleanup.
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

Current manual regression checklist:

- Visit every creator tab, randomize a character, review the level-1 sheet, join, see `?`, then see
  the generated portrait.
- Open your own and another party member's sheet.
- Switch narrator sex and verify the next sentence uses the selected voice.
- During narration: pause, resume, change volume, then mute mid-sentence.
- In Settings, independently mute and adjust music/effects; confirm the Now Playing label matches
  the scene, choices click, a requested roll cues, and combat/boss mood changes the arrangement.
- Create a named save, start a new game, load the save, and verify hero/story/voice restoration.
- Close the final browser during narration; verify audio stops and reopening restores state.

## Next product work

The roadmap remains authoritative. The most immediate incomplete Phase 1/2 items are compact
selectors for remaining level-1 class/spell choices, the broader SRD data import, starter scene-art
pregeneration, an optional authored music library, and 3D dice.
Do not confuse these planned features with defects in the current vertical slice.
