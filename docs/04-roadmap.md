# 04 — Roadmap

Principle: **every phase ends in something you can actually play.** Vertical slices, not layers.

## Phase 0 — Spike week (validate the scary parts before building anything)
Goal: prove the latency + VRAM story on the real 4070. Throwaway code allowed.
- [x] 8B Q4 (Ollama, llama3.1:8b): **TTFT 0.2–0.35 s, 60 tok/s** ✅ — see spikes/RESULTS.md
- [x] Constrained JSON tool-calls: **6/6 schema-valid, 1.4 s (8B) / 2.6 s (14B)** ✅
- [x] Kokoro: CPU RTF 0.64 (streams fine); first-audio 3.5 s full sentence / ~1.5–2.3 s
  first-clause ⚠️ → **decision: GPU sidecar in production, CPU fallback**
- [x] DreamShaper 8 + LCM-LoRA in ComfyUI while 8B stays loaded: **1.05 s/image warm,
  10.1 GB total VRAM, LLM unaffected (63 tok/s)** ✅
- [ ] ACE-Step: batch-generate 3 test mood tracks (deferred to Phase 2 — offline tooling,
  zero latency risk)
- **Exit criteria:** first token < 1 s ✅, first audio < 2 s (✅ via GPU-sidecar plan),
  image < 8 s async ✅ (1.05 s), no OOM ✅. **Phase 0 PASSED** — see spikes/RESULTS.md.

## Phase 1 — Solo text adventure that feels alive (the core MVP)
The game is fun for ONE player with text + voice only.
- [x] Node server (`ws` room, full-state sync — Colyseus deferred), React shell, SQLite
  write-through persistence *(built 2026-07-13, e2e verified)*
- [x] Rules engine v1: skill checks (nat 1/20), dice notation, ability/prof modifiers,
  damage/heal, seeded RNG — 20 unit tests
- [ ] SRD data import (5e-database JSON → SQLite) — using 4 hand-built pregens for now
- [x] DM orchestrator: constrained move pass (narrate / request_check / change_scene /
  give_item) + streamed narration pass; stall guard; semantic validation + retry
- [x] MVP character creation: pregen class picker, identity/flavor fields, randomizer, async
  portrait, and character-sheet drawer *(full SRD builder remains later work)*
- [x] Storyteller voice (Kokoro **CUDA sidecar**, ~190 ms/sentence, sentence-streamed with
  early first-clause) + streamed text
- [x] Scene-graph movement with clickable exits
- [x] Save/resume campaign (survives server restart + page refresh); session summaries pending
- [x] Settings: table-wide narrator choice, per-tab audio controls, named local save slots,
  disconnect autosave, and new-game/load flow
- **Playtest gate:** can you enjoyably play 2 hours solo and resume next day? *(ready to try)*
- Measured e2e (2026-07-13, clean GPU): action → first narration text **1.3 s**, opening
  scene art **2.3 s**, roll path verified (Stealth DC 13 requested by DM, engine-rolled).

## Phase 2 — Eyes and ears (the cinematic layer)
- [x] ComfyUI integration: async scene art + cache-by-signature *(landed early, in Phase 1 build)*
- [ ] Starter art library pregen script
- Live scene presentation (crossfade-in, Ken Burns drift, dramatic-beat stings), spoken
  session-start recap (non-blocking)
- Music mood library (ACE-Step batch tool + manifest) + crossfade player + `set_mood`
- [x] Character portraits at creation; NPC portraits remain pending
- 3D dice (dice-box) wired to roll requests

## Phase 3 — Friends join (multiplayer)
- Lobby, invite codes, seats, reconnection, drop-in/out
- Spotlight system; private whispers; per-player roll locks
- Tailscale/cloudflared setup docs + connection doctor in the launcher
- Multi-voice NPC dialogue
- **Playtest gate:** 3-player session, zero desyncs, spotlight feels fair

## Phase 4 — Real combat
- Zone-based tactical view, initiative, action bar from sheet, conditions, death saves
- Monster statblocks + behavior policy (constrained LLM pick → engine-validated)
- Encounter builder with XP budget + difficulty settings; monte-carlo balance harness
- Combat narration polish (crits, kills, boss-intro emphasis moments — art + sting, no interruption)

## Phase 5 — Depth & longevity
- Campaign skeleton/arc system with hidden outline revision
- Vector memory recall (sqlite-vec); NPC attitude tracking
- Level-up ceremonies, spellcasting (SRD subset), rests, shops/economy basics
- Content-safety preferences; host DM-override console
- Launcher app (one-click boot of all services, VRAM auto-profile)

## Later / icebox
- Voice input (whisper.cpp), style LoRA for consistent art, NPC voice cloning (Chatterbox),
  grid tactical mode, published-adventure import, world/premise marketplace sharing (JSON),
  spectator mode, Docker packaging for non-technical hosts.

## Suggested repo layout (monorepo)

```
Grimoire/
  packages/
    shared/        # zod schemas, types: actions, state, sheet (used by client+server)
    rules/         # deterministic 5e SRD engine + tests
    server/        # colyseus rooms, orchestrator, media director, persistence
    client/        # react app
  tools/
    music-batch/   # ACE-Step mood library generator
    scene-pregen/  # starter art library generator
    srd-import/    # 5e-database JSON → sqlite
  docs/
```
