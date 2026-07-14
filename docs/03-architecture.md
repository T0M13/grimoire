# 03 — Architecture & Tech Stack

> **Status (2026-07-14):** this document contains both the long-term architecture and early design
> choices. The playable build currently uses a singleton plain-`ws` room with full snapshots,
> Ollama rather than llama.cpp, SQLite JSON snapshots rather than normalized world tables, and a
> browser-local procedural soundtrack rather than authored ACE-Step files. There is no lobby,
> invite-code authentication, split-party activity model, or persistent world graph yet. Treat
> `docs/05-handoff.md` as the exact implementation record.

## 1. System overview

Everything runs on the host's PC. Players (including the host) connect with a browser.

```
                         Players' browsers (1–6)
                    React + Vite + TS + Tailwind
                 3D dice · scene canvas · sheet UI · audio player
                                  │  WebSocket (Colyseus) + HTTP (assets)
                                  ▼
┌───────────────────────── HOST PC (Windows, RTX 4070 12GB) ─────────────────────────┐
│                                                                                     │
│   Game Server — Node.js + TypeScript + Colyseus                                     │
│   ├─ Room state (authoritative): party, scene, combat, turn/spotlight               │
│   ├─ Rules Engine (pure TS): dice, checks, combat, conditions, encounter budget     │
│   ├─ DM Orchestrator: prompt assembly, tool-call loop, memory manager               │
│   ├─ Media Director: image queue+cache, TTS pipeline, music mood switcher           │
│   └─ Persistence: SQLite (better-sqlite3) + sqlite-vec for event memory             │
│                                                                                     │
│   AI sidecars (local HTTP services)                                                 │
│   ├─ llama.cpp llama-server  → DM brain (streaming + JSON-schema constrained)       │
│   ├─ ComfyUI headless        → scene art & portraits (async queue)                  │
│   └─ Kokoro TTS (kokoro-js in-process, or tiny FastAPI sidecar)                     │
│                                                                                     │
│   Offline (between sessions): ACE-Step 1.5 → mood music library                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
         Remote friends connect via Tailscale (recommended) / cloudflared tunnel
```

One command (`npm run host` or a small launcher app) boots server + sidecars.

## 2. Tech stack choices (and why)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + TypeScript + Tailwind** | Fast dev, huge ecosystem, easy for cinematic DOM/CSS animation (Framer Motion). No heavy game engine needed — this is UI, not a 3D game |
| Scene rendering | DOM/CSS + `<canvas>` where needed; **@3d-dice/dice-box** for dice | Ken Burns pan/zoom is pure CSS; zone combat is flex/absolute layout; keeps perf high on laptops/tablets |
| Multiplayer | **Colyseus** | Authoritative room state, delta-compressed sync, reconnection, matchmaking — exactly a 2–6 player room game. MIT, self-hosted, TypeScript end-to-end |
| Server runtime | **Node.js + TypeScript** | Shares types with frontend (character sheet, actions, state schemas in one `shared/` package) |
| Rules engine | **Custom TS package** + `rpg-dice-roller` + 5e-database JSON | Deterministic, unit-testable, LLM-independent |
| LLM serving | **llama.cpp `llama-server`** | OpenAI-compatible streaming API, GBNF/JSON-schema constrained decoding (guaranteed-valid tool calls), fine VRAM control, great Windows/CUDA support |
| Images | **ComfyUI** headless (API mode) | Model-agnostic (SDXL-Turbo today, Z-Image/Flux tomorrow), queue built-in, easy LoRA later |
| TTS | **Kokoro-82M** | <2 GB VRAM or CPU, way faster than realtime, quality narrator voices, Apache-2.0 |
| Music | **ACE-Step 1.5, offline batch** | Already installed; runtime music-gen is a latency/VRAM trap |
| DB | **SQLite** (better-sqlite3) + **sqlite-vec** | Zero-ops single-file saves; vector memory without another service |
| Networking for friends | **Tailscale** (default docs), cloudflared as alt | No port forwarding, encrypted, free, 5-minute setup |

## 3. The VRAM budget (the hard constraint)

RTX 4070 = 12 GB. Windows/desktop reserves ~0.5–1 GB. Two runtime profiles:

### Profile A — "Full Experience" (default, recommended)
| Component | Model | VRAM |
|---|---|---|
| DM brain | Qwen3-class **8–9B instruct, Q4_K_M**, 16k ctx | ~5.5–6.5 GB |
| Scene art | **SD1.5 + LCM-LoRA** or SDXL-Turbo (quantized) @ 512–768px | ~2.5–4 GB |
| Narrator | Kokoro-82M (or on CPU: 0 GB) | ~0–1 GB |
| **Total** | | **~9.5–11 GB** ✓ |

~80–90 tok/s narration, <1 s images, instant voice. Everything resident, no model swapping.

### Profile B — "Big Brain" (solo/text-focused, or 16 GB+ hosts)
14B Q4_K_M LLM (~9 GB) + Kokoro on CPU; images come from cache/pregen library, or on-demand
with a brief "painting..." state while ComfyUI briefly borrows VRAM (llama.cpp keeps weights,
generation queues). Smarter DM, slightly lazier art.

Config file exposes profiles; auto-detect VRAM at startup and suggest one.

**Rules of thumb baked into the design:** never load two big models for the same request path;
everything media is async; caches make the second occurrence of anything free.

## 4. The latency budget (what makes it feel "in the moment")

| Beat | Target | How |
|---|---|---|
| Player acts → first narration token on screen | **< 1.0 s** | Streaming from llama-server; prompt kept lean (structured state, not chat-log dumps); KV-cache reuse of the static system prompt |
| First spoken word | **< 2.0 s** | TTS kicks off on the first complete sentence, plays while the rest streams |
| Dice resolution | **instant** | Pure engine code; 3D dice animation *is* the wait (and it's fun) |
| Rules tool-call round-trip (LLM → engine → LLM) | < 2.5 s total | Tool call is a short constrained generation (~50 tokens); engine is sub-ms |
| Scene art appears | 2–8 s, **non-blocking** | Async queue + crossfade-in + cache-by-scene-signature + pregen starter library |
| Music change | instant | Pre-generated library crossfade |
| Combat: enemy turn resolved+narrated | < 5 s | Behavior policy is one small constrained generation; math is engine-side |

**North-star metric: time-to-first-spoken-word.** Instrument it from day one.

## 5. The DM Orchestrator (the heart)

### 5.1 Turn pipeline
```
player input(s)
  → assemble prompt: [system+world rules] [campaign state JSON] [scene beat] [recent dialogue] [input]
  → LLM pass 1 (constrained): choose DM move
      e.g. narrate | request_check{player,skill,dc,hidden} | start_combat{...}
           | deal_damage{...} | give_item{...} | move_party{node} | set_mood{tag}
           | spawn_scene{signature} | npc_dialogue{npc,voice,text} | advance_beat{...}
  → Rules Engine executes mechanical moves deterministically, returns results
  → LLM pass 2 (free text, streamed): narrate outcome
  → Media Director reacts to tags (mood/scene/cutscene) in parallel
  → state diff committed to SQLite; Colyseus broadcasts state patch
```
Simple narration collapses to a single streamed pass (the constrained "move" and the narration
are one call with a small structured header — keeps the common path to ONE generation).

### 5.2 Structured output strategy
llama.cpp `json_schema`/GBNF constrained decoding → tool calls are *grammatically guaranteed*
valid JSON. Server-side Zod validation as belt-and-braces; one silent retry on semantic
invalidity (e.g., targeting a dead NPC). No second "utility model" needed (revisit only if the
8B struggles with intent classification).

### 5.3 Memory manager
- **Campaign state JSON** (always in prompt, ~1–2k tokens): party summary, active quests,
  current location + neighbors, present NPCs w/ attitudes, world flags, inventory highlights.
- **Scene beat** (DM-private): current goal/obstacles/secrets — regenerated on beat change.
- **Recent dialogue:** last ~12 exchanges verbatim; older → rolling summary.
- **Vector recall:** every resolved event embedded into sqlite-vec; top-k retrieved when the
  input references the past ("that innkeeper", "the amulet we found").
- **Session close:** LLM writes a session summary + updates the hidden campaign outline.

## 6. Data model (SQLite, one file per campaign + a shared profile DB)

```
campaigns(id, name, premise, outline_json, settings_json, created_at)
characters(id, campaign_id?, owner_player, sheet_json, portrait_asset, alive)   -- reusable if campaign_id null
world_nodes(id, campaign_id, name, kind, description, neighbors_json, scene_signature, discovered)
npcs(id, campaign_id, name, statblock_ref?, attitude, facts_json, voice, portrait_asset)
quests(id, campaign_id, title, status, beats_json)
inventory(id, character_id, item_ref, qty, custom_json)
events(id, campaign_id, session_no, ts, kind, payload_json, embedding BLOB)      -- the log + vector memory
sessions(id, campaign_id, no, started, ended, summary)
assets(id, kind, scene_signature?, path, meta_json)                              -- generated images/audio cache
srd_* tables imported at build time from 5e-database JSON (spells, monsters, items, classes...)
```
Colyseus room state is the *live* projection; SQLite is the source of truth (write-through on
every resolved action → crash-safe, refresh-safe).

## 7. Frontend layout (one screen, two states)

- **Story state (default):** full-bleed scene art (Ken Burns drift, crossfades in live —
  never blocks input), narration band with typewriter text, party rail (portraits/HP/
  conditions) bottom-left, input + 3 suggested actions bottom, mini region-map toggle
  top-right, exits/POIs as glowing hotspots on the art. Dramatic beats = music sting +
  vignette emphasis, not a mode change.
- **Combat state:** art dims into background; zone cards slide in with tokens; initiative rail
  top; your action bar replaces free input on your turn (free-text "improvise" always there).
Character sheet, inventory, map, quest log, and settings use one non-modal dock rather than
navigation or a blocking backdrop. On desktop the composer reflows beside it; on mobile the dock
scrolls above the still-usable composer.
Mobile/tablet: the same layout stacks; dice and buttons are touch-first. Keep bundle lean; no
heavy 3D — the 3D dice canvas is the only WebGL surface.

## 8. Networking & hosting

- Colyseus over WebSocket, one room per campaign session; JWT-less simple auth: invite code +
  chosen seat, session cookie for reconnect identity.
- Static assets (generated art, audio) served by the same Node process; cached client-side.
- **Remote play:** Tailscale (docs default — zero port forwarding, works through CGNAT) or
  `cloudflared tunnel` for link-sharing without installing anything on friends' machines.
- Bandwidth is trivial (state diffs + occasional 200 KB image + streamed 24 kHz audio).

## 9. Testing strategy

- Rules engine: exhaustive unit tests (the whole point of engine-side math is testability).
- DM orchestrator: golden-transcript tests with a mocked LLM; schema fuzzing on tool calls.
- Latency: automated timing harness logging time-to-first-token / first-spoken-word per turn.
- Balance: monte-carlo combat sim (1000 fights per encounter template) to validate budgets.
