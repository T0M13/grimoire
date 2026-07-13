# 05 — Project handoff

Last updated: 2026-07-13

This is the fast orientation document for the next developer or AI working on Grimoire. Read
the four design documents for product intent; use this file for the exact implemented state.

## Current state

Phase 1 is a playable local-first vertical slice. A player can create a level-3 hero from four
SRD-style templates, optionally randomize all creation fields, generate a custom portrait, begin
a campaign, act through free text or suggestions, make deterministic skill checks, hear streamed
Kokoro narration, see asynchronous scene art, inspect character sheets, and resume from SQLite.

The game supports multiple browser clients on one authoritative WebSocket room, but the full
multiplayer lobby/seat/spotlight feature set remains Phase 3 work.

## Implemented features

- React/Vite/Tailwind client with reconnect-safe identity in browser local storage.
- Character creation: name, sex, age, class template, written bio, and one-click randomizer.
- Background portrait generation with a `?` placeholder until the image is ready.
- Clickable party badges and a character-sheet drawer for every party member.
- Constrained two-pass AI DM: structured move selection, then streamed narration.
- Deterministic rules engine for dice, skill checks, damage, and healing; automated test suite.
- Async ComfyUI scene art with scene-signature caching and crossfade presentation.
- Kokoro CUDA narration using `bm_fable` (male) and `af_heart` (female).
- Per-tab mute, volume, and pause/resume. Muting cuts the current sentence immediately.
- Table-wide narrator selection persisted in campaign state.
- Continuous SQLite campaign persistence plus named host-local save/load/delete slots.
- Disconnect autosave. Closing/disconnecting the final browser also aborts in-flight TTS.
- Cross-platform host supervisor with per-service logs and automatic cleanup 15 seconds after
  the final browser disconnects; reconnecting during the grace period cancels shutdown.
- Linux server mode binds the web UI/game API for remote clients while keeping model sidecars
  private on loopback; persistent mode and a systemd unit template support always-on hosts.
- New-game flow that keeps named saves and the selected narrator available.

## Fresh-clone setup

Windows hosts run `./start.ps1`. It invokes the idempotent `setup.ps1` before launching anything.
The bootstrap installs missing prerequisites through winget, runs `npm ci`, clones the tested
ComfyUI revision, creates the shared ComfyUI/Kokoro virtual environment, downloads DreamShaper 8
and LCM-LoRA, starts Ollama, and pulls `llama3.1:8b`. Expensive steps are skipped after success.

Run `./setup.ps1 -Check` for a read-only readiness report. The first setup needs a stable internet
connection, roughly 10 GB of free disk space, and several minutes for model downloads. The target
host is Windows 11 with an NVIDIA RTX 4070 12 GB; CPU narration remains possible but slower.

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
- `packages/client/src/App.tsx`: character creation, game screen, sheet, and settings UI.
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
- Mute and volume are per browser tab/profile (`localStorage`). Narrator sex is table-wide state.
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

- Randomize a character, join, see `?`, then see the generated portrait.
- Open your own and another party member's sheet.
- Switch narrator sex and verify the next sentence uses the selected voice.
- During narration: pause, resume, change volume, then mute mid-sentence.
- Create a named save, start a new game, load the save, and verify hero/story/voice restoration.
- Close the final browser during narration; verify audio stops and reopening restores state.

## Next product work

The roadmap remains authoritative. The most immediate incomplete Phase 1/2 items are SRD data
import, a full guided character builder, starter scene-art pregeneration, music, and 3D dice.
Do not confuse these planned features with defects in the current vertical slice.
