---
name: Grimoire
description: Working on the Grimoire project — a self-hosted, AI-Dungeon-Mastered D&D web game (1–6 players, host's RTX 4070 runs all AI). Use when implementing, reviewing, or designing anything in this repo: game server, rules engine, DM orchestrator, media pipeline, or web client.
---

# Grimoire project Skill

You are working on **Grimoire**: a local-first multiplayer (1–6 player) D&D-style web game where
the Dungeon Master is a locally hosted AI. Read `docs/` before large changes:
`01-game-design.md` (what the game is), `02-research.md` (prior art), `03-architecture.md`
(stack, VRAM/latency budgets), `04-roadmap.md` (current phase). Measured baselines live in
`spikes/RESULTS.md`.

## Non-negotiable principles (enforce these in every change and review)

1. **Latency is a feature.** Time-to-first-token < 1 s, time-to-first-spoken-word < 2 s.
   Never add a blocking step to the player-action → narration path. Media (images, music) is
   always async and never gates the story. If a change adds an LLM round-trip to the common
   path, push back.
2. **The LLM narrates; the rules engine adjudicates.** No dice rolls, HP math, DC-setting
   arithmetic, or rules decisions inside prompts or LLM output parsing. The LLM emits
   *structured tool calls* (schema-constrained via Ollama `format`); `packages/rules` resolves
   them deterministically. Any change that lets narrative text mutate mechanical state is wrong.
3. **VRAM budget is law (12 GB total, shared with the user's desktop apps/games).**
   Current residents: llama3.1:8b @ num_ctx 4096 (~5.4 GB) + SD1.5/LCM via ComfyUI dynamic
   loading (~2 GB transient) + Kokoro CUDA (~1.3 GB). Games like League of Legends can starve
   the GPU — everything must degrade gracefully (stall guard aborts narration at 30 s idle).
4. **Everything persists.** Every resolved action is written through to SQLite before the
   state broadcast. A crash or refresh must never lose more than the in-flight turn.
5. **Server is authoritative.** Clients send intents (`ClientMessage`), never state. Zod-parse
   everything at the boundary.
6. **SRD only.** Only 5e SRD (CC-BY) content in code, data, and prompts — no PHB/non-SRD
   monsters, spells, or trademarked names (e.g., no "beholder", no "Mordenkainen").

## Architecture quick map (as implemented)

- `packages/shared` — Zod schemas + TS types: `DmMove` (+ `DM_MOVE_JSON_SCHEMA` for Ollama),
  `Character`, `Scene`, `ClientMessage`/`ServerMessage` wire protocol, `PublicState`.
  Change schemas here first; client and server import the TS source directly.
- `packages/rules` — pure deterministic 5e engine: seeded RNG (`seededRng`), dice notation,
  `resolveCheck` (nat 1/20 rules), damage/heal, `PREGEN_CHARACTERS`. No I/O, no LLM; every
  mechanic unit-tested with injected RNG.
- `packages/server` — plain `ws` WebSocket room (`game.ts`, full-state JSON broadcast — small
  state, no delta sync needed yet; Colyseus deferred until scale demands), DM orchestrator
  (`dm.ts`: constrained move pass → streamed narration pass), media director (`media.ts`:
  ComfyUI async queue + cache-by-scene-signature, Kokoro sentence streaming via
  `SentenceStream` with early first-clause emit), SQLite write-through (`db.ts`),
  config in `config.ts` (ports, models, style prompts).
- `packages/client` — React/Vite/Tailwind v4. One screen: join → story. `useGame.ts` owns the
  socket, reconnection, and the sequential narration-audio queue. `App.tsx` includes randomized
  creation, character sheets, and settings/save controls. `SceneArt` crossfades new art in behind
  the story; presentation never blocks input.
- Sidecars (HTTP, may be down — text-only mode must always work):
  - Ollama `:11434` (llama3.1:8b, constrained JSON via `format`)
  - ComfyUI `:8188` headless (`spikes/run-comfy.ps1`; install at `vendor/ComfyUI` with own venv)
  - Kokoro TTS `:7861` (`tools/tts-sidecar/server.py`, runs on CUDA inside the ComfyUI venv)

## Commands

- `npm test` (vitest, all packages) · `npm run typecheck` (tsc strict, whole repo)
- Fresh clone/readiness: `.\start.ps1` installs then launches · `.\setup.ps1 -Check` is read-only
- `npm run dev:server` (:7777) · `npm run dev:client` (Vite :5173, `--host` for LAN)
- Sidecars: `powershell spikes/run-comfy.ps1` · `vendor\ComfyUI\venv\Scripts\python.exe tools\tts-sidecar\server.py`
- E2E: `node spikes/e2e-smoke.mjs` (drives join → campaign → action → roll over ws)
- Reset campaign: delete `var/grimoire.db*` (generated art/audio cache lives in `var/assets/`)

## Conventions

- TypeScript strict everywhere; Zod-validate every LLM output and every client message.
- LLM tool calls use constrained decoding — never regex-parse free text for mechanics.
- New DM capabilities = extend `DmMove` + `DM_MOVE_JSON_SCHEMA` in `shared`, handle in
  `game.ts` `onAction`, add narration guidance in `prompts/dm-system.md`. Keep moves small.
- Asset cache keys: `sceneSignature` = kind/timeOfDay/weather/mood, joined with `--`,
  lowercase alnum+dash only (Windows-safe filenames — no `|`, `:`, `/`).
- Prompts live in versioned files (`packages/server/prompts/`), not inline strings.
- Windows gotchas: PowerShell 5.1 `Get-Content`/`Set-Content` mangles UTF-8 (use Write/Edit
  tools); `|` is illegal in filenames; prefer `curl.exe` over `Invoke-WebRequest` for binaries.

## Testing expectations

- `packages/rules`: unit tests required for every mechanic (seeded RNG).
- Orchestrator/media changes: unit-test pure parts (e.g. `SentenceStream`), then run the e2e
  smoke script against the live stack before calling it done.
- Combat/encounter changes (Phase 4+): run the monte-carlo balance sim before merging.
- End every change summary with a short manual-test checklist (user preference).

## When designing new features, ask in this order

1. Does it block the narration path? (If yes, redesign as async.)
2. Does it fit the VRAM budget? (If no, cache/pregen/offline it.)
3. Can the engine adjudicate it deterministically? (If no, it's narration-only flavor.)
4. Does it work solo AND with 6 players? (Spotlight, roll-locks, skip-votes.)
5. Does it persist and survive reconnect?
