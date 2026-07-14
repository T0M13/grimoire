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
- [x] Rules engine v1: RAW ability checks (no automatic natural 1/20 result), fixed SRD difficulty
  categories/DCs, dice notation, ability/proficiency modifiers, damage/heal, seeded RNG, all three
  ability methods, build validation, and derived level-1 HP/AC
- [ ] SRD data import (5e-database JSON → SQLite) — using 4 hand-built pregens for now
- [x] DM orchestrator: constrained move pass (narrate / request_check / change_scene /
  give_item) + streamed narration pass; stall guard; semantic validation + retry
- [x] Guided SRD character creation: six compact tabs, nine races, twelve classes, standard/point
  buy/rolled abilities, class/racial/background skills, languages, legal equipment packages,
  level-1 features/default spells, full randomizer, portrait, review, and sheet drawer
- [ ] Complete remaining level-1 choices: fighting-style alternatives, Expertise targets, ranger
  choices, flexible tools/languages, individual spell selection, and coin-buy equipment
- [x] Storyteller voice (Kokoro **CUDA sidecar**, ~190 ms/sentence, sentence-streamed with
  early first-clause) + streamed text; American/British G2P pipelines share one loaded model
- [x] Clickable current-scene exits plus an honest Scene Map drawer
- [ ] Persistent discovered-location graph, stable exit IDs, locked/unknown paths, and region layout
- [x] Save/resume campaign (survives server restart + page refresh); session summaries pending
- [x] Settings: table-wide narrator choice, per-tab audio controls, named local save slots,
  disconnect autosave, new-game/load flow, and hidden process lifecycle with last-tab cleanup
- [x] Pre-character journey chooser: New Journey, Load Saved Journey, and Join Current Journey
  with table-wide replacement warnings and server acknowledgements
- [x] Tab-local procedural soundscape: 12 moods × 3 restrained movements, deterministic
  scene/time/weather scoring, 150-second movement changes, soft crossfades, clean combat/boss
  arrangements, gameplay cues, and independent music/effects controls
- [x] Explicit Act / Speak / Ask DM input modes with labeled speakers
- [x] Table-wide Standard/Mature story tone: default-safe, shared opt-in, requested dark humor/gore,
  adult consensual fade-to-black romance, and immutable consent/age boundaries
- [x] Per-hero persistent NPC relationships with server-owned trust/affection deltas, deferred
  roll outcomes, friendship/rivalry/hostility, and conservatively gated mutual romance
- [x] Persistent per-NPC Kokoro voice identity and bounded delivery rate selected from
  sex/personality descriptors, with no extra model call
- [x] Non-modal Map, Sheet, Quest, and Settings docks that keep the action composer usable
- [x] Structured main/side quest transitions and a Quest Journal drawer
- [x] Grouped inventory cards with lightweight code-native category icons
- **Playtest gate:** can you enjoyably play 2 hours solo and resume next day? *(ready to try)*
- Measured e2e (2026-07-13, clean GPU): action → first narration text **1.3 s**, opening
  scene art **2.3 s**, roll path verified (Stealth DC 13 requested by DM, engine-rolled).

## Phase 2 — Eyes and ears (the cinematic layer)
- [x] ComfyUI integration: async scene art + cache-by-signature *(landed early, in Phase 1 build)*
- [ ] Starter art library pregen script
- Live scene presentation (crossfade-in, Ken Burns drift, dramatic-beat stings), spoken
  session-start recap (non-blocking)
- [x] Mood-driven crossfade player and optional DM mood changes (procedural MVP)
- [ ] Optional ACE-Step authored music batch tool + manifest to replace procedural profiles
- [x] Character portraits at creation plus async, cached, style-consistent NPC/creature portraits
- [x] Living-subject-free scene backgrounds with structured visible occupants and dialogue avatars
- 3D dice (dice-box) wired to roll requests

## Phase 3 — Friends join (multiplayer)

- [x] Shared sequential WebSocket room, convergent party state, named roll ownership, reconnect,
  and per-tab audio controls (two-client unit coverage)
- [x] Transient online/activity presence, visible new-character join events, and stale socket-identity
  cleanup across table-wide load/reset; reconnect churn stays out of the saved story log
- [x] Actor-addressed shared narration: the active character is "you", but every tab still receives
  the same rendered beat
- [ ] Recipient-aware private/shared narration and audio feeds
- [ ] Authenticated seats, host controls, invite codes, and a real lobby/drop-in flow
- [ ] Location/activity model for split-party exploration and parallel NPC conversations
- [ ] Personal, party, and world quest/event journal with deterministic transitions
- [ ] Material-event promotion: local actions can interrupt or update every affected player
- [ ] Persistent NPC descriptions and cached dialogue shots within stable location art
- Full design and staged delivery: `06-open-world-multiplayer.md`

## Phase 4 — Advancement and complete encounters

- Deterministic experience or milestone awards and SRD level thresholds
- Deferred level-up flow with class feature tables and compact required-choice tabs
- Legal Ability Score Improvement allocation at the class levels that grant it (not free-form skill points)
- Hit-point increase, proficiency-bonus changes, spell slots/known/prepared choices, and resource tracking
- Structured inventory entities (quantity, category, weight, equipped state, description, optional art key)
- Full attacks, initiative, actions, damage, conditions, rests, death saves, and spell effects
- Detailed design and implementation order: `08-progression-and-content.md`
- Spotlight system; private whispers; per-player roll locks
- Tailscale/cloudflared setup docs + connection doctor in the launcher
- **Playtest gate:** 3-player session, zero desyncs, spotlight feels fair

## Phase 5 — Tactical combat presentation
- Zone-based tactical view, initiative, action bar from sheet, conditions, death saves
- Monster statblocks + behavior policy (constrained LLM pick → engine-validated)
- Encounter builder with XP budget + difficulty settings; monte-carlo balance harness
- Combat narration polish (crits, kills, boss-intro emphasis moments — art + sting, no interruption)

## Phase 6 — Depth & longevity
- Campaign skeleton/arc system with hidden outline revision
- Vector memory recall (sqlite-vec); deeper NPC memories, favors, factions, and relationship arcs
- Level-up ceremonies, spellcasting (SRD subset), rests, shops/economy basics
- Per-topic lines/veils, host-only content controls, and DM-override console
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
