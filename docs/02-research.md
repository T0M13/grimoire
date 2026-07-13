# 02 — Research: existing tools, repos, and what we reuse

Surveyed July 2026.

## 1. Commercial products (the competition / proof it works)

| Product | What it proves | Why we still build our own |
|---|---|---|
| [Friends & Fables](https://fables.gg/) | The exact concept works: AI GM "Franz", 5e-inspired, multiplayer up to 6, image gen, stat tracking, 100k+ users | Cloud, subscription, capped by API costs, not moddable, no local models, no narrator voice focus |
| AI Realm | Web AI GM on 5e SRD, inline dice, combat in text | Same: cloud + subscription |
| AI Dungeon | Pioneered LLM adventures | No rules engine → drifts, forgets, unbalanced; single-player-centric |
| [Familiar VTT](https://familiarvtt.com/) | AI can run *published* adventures inside Foundry | Tied to Foundry's VTT paradigm; BYO cloud API |

**Takeaway:** the market validates every feature we want; nobody offers *local-first + spoken
storyteller + cinematic presentation + real rules engine* in one package. That's our slot.

## 2. Open-source projects worth studying (and stealing patterns from)

| Repo | What it is | What to take |
|---|---|---|
| [tegridydev/dnd-llm-game](https://github.com/tegridydev/dnd-llm-game) | Local-first D&D web app on Ollama. FastAPI + SSE streaming, Vite/React, SQLite, LanceDB for PDF lore RAG, reusable heroes, **two-model pattern** (big DM model narrates, small utility model extracts state/dice/choices) | Closest prior art. Study its two-model split and SSE streaming; we improve on it with grammar-constrained single-model tool calls, multiplayer, voice, and media |
| [deckofdmthings/GameMasterAI](https://github.com/deckofdmthings/GameMasterAI) | Open-sourced web Grimoire (GPT-3.5/4 era), single-player | Prompt structure for DM behavior; UI flows for solo play |
| [samvoisin/ai-dungeon-master](https://github.com/samvoisin/ai-dungeon-master) | Discord bot Grimoire (GPT-4 + LlamaIndex) | Scene/combat/NPC prompt separation |
| [Tsinx/aidnd](https://github.com/Tsinx/aidnd) | Multi-agent LLM DM (specialized agents cooperate) | Agent decomposition ideas — but beware latency: every extra agent hop costs seconds |
| [northern-lights-province/calypso-aiide-artifact](https://github.com/northern-lights-province/calypso-aiide-artifact) | CALYPSO research: LLMs as DM assistants (published paper) | Academic grounding on what LLM-DMs get wrong (rules, pacing) |
| [ai-dungeon-master topic](https://github.com/topics/ai-dungeon-master) | Ongoing stream of similar experiments | Periodic re-check |

**Build vs. fork decision: build our own, reuse components.** Nothing above has our
presentation layer (voice/cinematics/music), real multiplayer, or an authoritative rules
engine. Forking a Streamlit/Discord/solo codebase buys little; the valuable reusables are
libraries and data, below.

### Why not Foundry VTT + AI module?
Modules like FoundryAI / RPGX AI Assistant (Ollama, fully local) exist and are impressive —
but Foundry is a *grid VTT for human DMs*; the AI is an assistant bolted onto chat. Our game is
narration-first with a completely different UI. Foundry would give us tokens and walls we don't
want and none of the cinematic layer we do. **Verdict: no.** (Worth revisiting only if we ever
want a hardcore tactical mode.)

## 3. Rules & content (the part we must NOT generate with AI)

| Resource | Use |
|---|---|
| **5e SRD 5.1/5.2 (CC-BY-4.0)** | The legal basis. We implement an SRD subset |
| [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (dnd5eapi JSON) | Full SRD as clean JSON: classes, races, spells, monsters, equipment. Import at build time — no runtime API dependency |
| [Open5e](https://open5e.com/) / [open5e repo](https://github.com/open5e/open5e) | Extra CC monsters (Tome of Beasts etc.) for variety |
| [dice-roller/rpg-dice-roller](https://github.com/dice-roller/rpg-dice-roller) | Battle-tested dice notation parsing (`2d6+3`, advantage, keep/drop) |
| [3d-dice/dice-box](https://github.com/3d-dice/dice-box) | Gorgeous physics-based 3D dice in the browser — the "juice" for roll moments |
| SRD encounter-building math (XP budgets/CR) | Deterministic encounter balancing |

## 4. AI runtime research summary (details in architecture doc)

- **LLM serving:** llama.cpp `llama-server` (OpenAI-compatible, GBNF/JSON-schema constrained
  output, streaming) is the right backbone for a single-GPU Windows host. Ollama acceptable
  for dev convenience; llama.cpp gives more control (KV cache, speculative decoding).
  Benchmarks: 8B Q4 ≈ 80–95 tok/s on a 4070-class card — far faster than reading speed.
  vLLM is Linux/serving-farm oriented — overkill and awkward on Windows.
- **Models (12 GB):** Qwen3/3.5 8–9B class Q4 as the resident DM brain (fast profile);
  a 14B Q4 fits (~8.5–9 GB) when media models aren't resident (quality profile).
- **Images:** SDXL-Turbo (1–4 steps, <1 s at 512px), Flux.1-schnell fp8 (8–15 s, prettier),
  Z-Image Turbo 6B (~2–3 s at 1024, quality/speed sweet spot but ~fp8 VRAM-tight on 12 GB
  alongside an LLM). Served via ComfyUI headless API or sd.cpp. Strategy: small always-resident
  model + caching + async delivery (see architecture).
- **TTS:** **Kokoro-82M** is the clear winner — Apache-2.0, <2 GB VRAM (runs on CPU too),
  many-times-faster-than-realtime, excellent narrator quality, multiple voices. Runs via
  ONNX in Node (`kokoro-js`) or a tiny Python sidecar. Chatterbox (0.5B, MIT) later if we want
  voice cloning for signature NPCs.
- **Music:** ACE-Step 1.5 (already installed locally) for **offline batch generation** of the
  mood library. Runtime music generation is a non-goal (latency + VRAM). Alternatives for
  texture one-shots: Stable Audio Open, MusicGen.
- **Multiplayer:** **Colyseus** (MIT, Node/TypeScript) — authoritative rooms, delta-compressed
  state sync, matchmaking, reconnection support out of the box. Exactly our shape (room-based,
  turn/spotlight, 2–6 clients). socket.io would mean hand-rolling state sync; raw WebSockets
  even more so.
- **Structured output reliability:** industry pattern = constrained decoding (grammar/JSON
  schema at the sampler level) + schema validation + one retry. llama.cpp supports GBNF and
  `json_schema` natively → we get **guaranteed-parseable DM tool calls** from a single local
  model. This replaces dnd-llm-game's second "utility model" in most cases.

## 5. Key risks flagged by research

1. **VRAM contention** (LLM + image + TTS on 12 GB) — solved by model sizing, caching,
   async media, and profiles. Biggest engineering constraint; treated first-class in the
   architecture doc.
2. **LLM rules drift** — the reason AI Dungeon feels unfair. Solved by the engine-adjudicates
   principle; the LLM literally cannot roll dice or set HP.
3. **Long-campaign memory** — solved with layered memory (structured state + summaries +
   vector recall). Research consensus: structured state in-prompt beats pure RAG for games.
4. **Latency perception** — solved by token streaming + sentence-streamed TTS + never blocking
   on media. "Time to first spoken word" is the metric that matters, not total generation time.

## Sources

- [Friends & Fables](https://fables.gg/) · [AI GM comparisons 2026](https://dungeonsdeep.ai/blog/the-best-ai-game-masters-compared-in-2026) · [solo AI D&D guide](https://wilds.ai/blog/play-dnd-solo-with-ai)
- [dnd-llm-game](https://github.com/tegridydev/dnd-llm-game) · [GameMasterAI](https://github.com/deckofdmthings/GameMasterAI) · [ai-dungeon-master bot](https://github.com/samvoisin/ai-dungeon-master) · [aidnd](https://github.com/Tsinx/aidnd) · [CALYPSO](https://github.com/northern-lights-province/calypso-aiide-artifact)
- [RTX 4070 LLM sizing](https://modelfit.io/gpu/rtx-4070/) · [llama.cpp 4070 tuning](https://www.xda-developers.com/tested-local-llms-on-rtx-4070-ti-for-real-work-only-one-earned-spot/) · [VRAM guide](https://www.promptquorum.com/local-llms/local-llm-hardware-guide-2026)
- [Local image models 2026](https://localaimaster.com/blog/best-local-image-models-compared) · [image VRAM guide](https://willitrunai.com/blog/image-generation-vram-guide-2026)
- [Local TTS 2026](https://localaimaster.com/blog/best-local-tts-models) · [Kokoro setup](https://localaimaster.com/blog/kokoro-tts-local-setup)
- [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) · [open-source music gen](https://www.it-jim.com/blog/best-open-source-ai-music-generator/)
- [Colyseus](https://colyseus.io/) · [Colyseus repo](https://github.com/colyseus/colyseus)
- [Open5e](https://open5e.com/) · [5e-database](https://github.com/5e-bits/5e-database)
- [Structured output reliability](https://eastondev.com/blog/en/posts/ai/20260506-llm-structured-output/) · [structured outputs guide](https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms)
- [FoundryAI](https://foundryvtt.com/packages/foundry-ai) · [RPGX AI Assistant](https://foundryvtt.com/packages/rpgx-ai-assistant) · [Familiar](https://familiarvtt.com/)
