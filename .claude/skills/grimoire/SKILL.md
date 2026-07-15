---
name: grimoire
description: "Work on Grimoire, a self-hosted AI-Dungeon-Mastered SRD web game. Use when implementing, reviewing, testing, or designing this repository's game server, deterministic rules engine, DM orchestrator, media pipeline, character creator, or web client."
---

# Grimoire project Skill

You are working on **Grimoire**: a local-first D&D-style web game designed for 1–6 players, where
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
   Read `docs/07-srd-rules-coverage.md` before changing character creation or mechanics. Never
   describe the engine as rules-complete beyond that matrix, and preserve `NOTICE.md` attribution.
7. **New heroes use the 2014 six-step level-1 flow.** Keep creation in compact tabs; randomization
   must produce a legal complete build. Clients send choices, and the server reconstructs the sheet.
8. **Prompts are not enforcement.** Give the narrator authoritative character facts, but guarantee
   mechanics through schemas and `packages/rules`. Ability checks do not auto-succeed/fail on a
   natural 20/1. The model emits a named difficulty; code maps it to DC 5/10/15/20/25/30.
9. **Mature tone is shared opt-in, not an instruction.** Standard is the default. Mature permits
   only player-requested dark humor, brief fictional gore, and adult consensual romance; intimacy
   always fades to black. Never add explicit sexual description, minors, coercion, sexual violence,
   incest, intoxicated/incapacitated consent, or eroticized captivity. Art remains nonsexual.
10. **Relationships use fixed reducers.** The model may select a schema event, never trust/affection
    numbers. Apply immediate events server-side and defer check-dependent events until the real roll.
    Social checks can affect attitude but never create consent. Mutual romance needs Mature mode,
    established trust/affection, an adult/elder hero, and an NPC explicitly established as an adult person.

## Architecture quick map (as implemented)

- `packages/shared` — Zod schemas + TS types: `DmMove` (+ `DM_MOVE_JSON_SCHEMA` for Ollama),
  `Character`, `Scene`, quests/NPC speakers, `ClientMessage`/`ServerMessage` wire protocol,
  `PublicState`.
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
- `packages/client` — React/Vite/Tailwind v4. Flow: journey chooser → character creator → shared
  story. `JourneyGate.tsx` owns New/Load/Join Current entry; `CharacterCreator.tsx` owns the compact
  guided SRD flow; `useGame.ts` owns the
  socket, reconnection, and the sequential narration-audio queue. `useSoundscape.ts` owns the
  tab-local Web Audio music/SFX graph, mood crossfades, cue routing, and persisted controls.
  `App.tsx` includes SRD point-buy
  creation, class skill choices, randomized legal builds, full skill/save sheet views, and settings.
  `SceneArt` crossfades new art behind the story; presentation never blocks input.
- Sidecars (HTTP, may be down — text-only mode must always work):
  - Ollama `:11434` (llama3.1:8b, constrained JSON via `format`)
  - ComfyUI `:8188` headless (`spikes/run-comfy.ps1`; install at `vendor/ComfyUI` with own venv)
  - Kokoro TTS `:8765` (`tools/tts-sidecar/server.py`, runs on CUDA inside the ComfyUI venv)

## Commands

- `npm test` (vitest, all packages) · `npm run typecheck` (tsc strict, whole repo)
- Fresh clone/readiness: Windows `.\start.ps1` / `.\setup.ps1 -Check`; Linux `./start.sh` /
  `./setup.sh --check`. Both bootstrap the local runtime/model stack idempotently.
- Cross-platform convenience (after Node/npm exists): `npm start`, `npm run start:persistent`,
  and `npm stop`; these dispatch to the platform launcher rather than duplicating host logic.
- Host lifecycle: services are backgrounded and supervised; `.\stop.ps1` or `./stop.sh` stops
  immediately. Desktop mode cleans up after the final browser disconnect; Linux
  `./start.sh --persistent` (or Windows `.\start.ps1 -Persistent`) stays available as a server.
- Linux systemd: adapt `deploy/grimoire.service` after setup. Only ports 8786/8787 are remotely
  bound; keep model sidecars private and use LAN/VPN or authenticated TLS proxy access.
- `npm run dev:server` (:8787) · `npm run dev:client` (Vite :8786, `--host` for LAN)
- Sidecars: `powershell spikes/run-comfy.ps1` · `vendor\ComfyUI\venv\Scripts\python.exe tools\tts-sidecar\server.py`
- E2E: `node spikes/e2e-smoke.mjs` (drives join → campaign → action → roll over ws)
- Visual media smoke: `npm run smoke:visual` paints one sanitized environment, one person, and one
  creature without reading or mutating campaign SQLite state.
- Reset campaign: delete `var/grimoire.db*` (generated art/audio cache lives in `var/assets/`)

## Conventions

- TypeScript strict everywhere; Zod-validate every LLM output and every client message.
- LLM tool calls use constrained decoding — never regex-parse free text for mechanics.
- New DM capabilities = extend `DmMove` + `DM_MOVE_JSON_SCHEMA` in `shared`, handle in
  `game.ts` `onAction`, add narration guidance in `prompts/dm-system.md`. Keep moves small.
- Preserve the three player intent modes. `Act` may change the world, `Speak` must produce a direct
  NPC conversational response (or a social check with a later response), and `Ask DM` answers
  directly without advancing time or silently performing an action.
- Preserve the pacing contract (docs/05-handoff.md, "Pacing and presentation contract"): stated
  movement executes as `change_scene` that beat, beats stay 1-3 sentences, and exploration/needed
  clues are free. Request a check only for real opposition, danger, or time pressure with an
  interesting failure; never reroll the same failed attempt. New player turns cancel stale
  narration audio (`cancelAudio(true)` + `audio_stop`), and scene art uses the quality dpmpp_2m
  workflow, never the LCM draft sampler.
- Keep establishing scene art free of every living subject. Put named people and creatures in
  `Scene.occupants`; generate their close-up portraits asynchronously with look/type/style in the
  cache signature; render `?` until ready. Never put a tiny face back into a wide SD1.5 scene.
- Preserve subject appearance from `npcVoices` and keep style-specific portrait URLs. A new art
  style repaints the environment and visible subject cards without blocking dialogue.
- Persist NPC voice identity by normalized name. Keep narrator voices outside the NPC pool, route
  all voice audio through the existing cancellable per-tab queue, and never add TTS to the blocking
  narration path.
- Apply quests only from schema-validated `QuestUpdate` intents through the server reducer. Never
  infer quest or mechanical state from narration text.
- Apply NPC relationships only from schema-validated `RelationshipUpdate` events through the fixed
  server reducer. Key them by stable character id and normalized NPC name, persist them in campaign
  state, and never infer them from narration text. Check branches live in `pendingRelationship` until
  the named player's deterministic roll resolves.
- Do not implement advancement as free-form points. Read `docs/08-progression-and-content.md`, add
  SRD class-level data and deterministic reducers/tests, then expose only legal pending choices.
- Keep music and effects non-blocking, browser-local, and disposable on `pagehide`. Scene mood is
  authoritative; the DM may provide optional `DmMove.mood` when tone changes. Preserve the 12 mood
  keys and three deterministic movements per mood. Location kind, time, and weather may color the
  score; rotation timers and AudioContext nodes must clean up with the tab.
- The shipped Map is a current-scene projection only. Do not call exit strings a persistent scene
  graph. Stable location/exit IDs and topology belong to the server-owned Phase 3 world model.
- Today's multiplayer is one sequential public room: one scene, global `dmBusy`/pending roll,
  name-only reconnect, and table-wide narration/audio. `party_presence` is transient (never saved)
  and shows Ready/Acting/Speaking/Asking DM/Rolling/Following/Offline while the saved `party` remains
  the full roster. Active-table load/reset requires a joined hero, but there is no host role yet.
  Test two heroes with isolated browser profiles; never claim private dialogue,
  personal quest visibility, parallel actions, split parties, host authorization, or seat limits.
- Asset cache keys include location name/kind/time/weather/mood plus a hash of the composition
  prompt, joined with `--`, lowercase alnum+dash only (Windows-safe filenames).
- Narration for an active character must be second-person (`you/your`), never their own name or
  third-person pronouns. Parallel dialogue/event design lives in `docs/06-open-world-multiplayer.md`.
- Base/content prompts live in versioned files (`packages/server/prompts/`). Both structured and
  narration passes must receive the selected Standard/Mature policy and the absolute boundaries.
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
