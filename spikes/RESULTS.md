# Phase 0 spike results

## LLM benchmark — 2026-07-12 (`llm-bench.mjs`, Ollama, num_ctx 8192, realistic DM prompt ~625 tok)

Measured on the target host (RTX 4070 12 GB) **with ~5 GB VRAM already used by other
desktop apps** (Unity/Blender/etc. were open) — i.e., worst-case conditions.

| | llama3.1:8b (Profile A) | qwen2.5:14b (Profile B) |
|---|---|---|
| Time to first token (warm) | **0.18–0.35 s** ✅ | **0.16–0.55 s** ✅ |
| Narration speed | **59.9 tok/s** ✅ | 32.4 tok/s ✅ (still 2× reading speed) |
| Tool-call latency (schema-constrained) | **1.4 s** ✅ | 2.5–2.8 s ⚠️ ok, not great |
| Schema-valid JSON | **3/3** ✅ | **3/3** ✅ |
| VRAM used (total incl. other apps) | 7.9 GB → **~4.4 GB free for image+TTS** ✅ | 11.9 GB → **full, no room for media** |
| Cold model load | 49.6 s (once per session) | 21.7 s |

### Conclusions
- **Targets met with room to spare.** TTFT target was <1 s; we got ~0.2 s. Ollama is fine as
  the serving layer for now — llama.cpp direct only if we later need KV-cache tricks.
- **Profile A (8B) is the default**, as planned: leaves ~4+ GB free for image gen + TTS even
  with a messy desktop. Profile B (14B) fills the card — text-focused mode only.
- Constrained output works: Ollama `format: <json-schema>` returned valid JSON 6/6 across
  both models. Semantic quality differs (the 8B actually picked the more sensible move than
  the 14B in one sample) → invest in the move-selection prompt, not model size.
- Cold-load is noticeable (20–50 s) → launcher should preload the model while players sit in
  the lobby.
- Note: newer 8–9B models (e.g. Qwen3 class) may narrate better than llama3.1:8b — worth a
  bake-off later; the harness (this script) makes that a 5-minute test.

## Kokoro TTS benchmark — 2026-07-12 (`tts/kokoro-bench.mjs`, kokoro-js q8 on **CPU**)

- Model load: 5.6 s (once). Voice: `am_michael` (deep narrator).
- Full-sentence synth: RTF 0.62–0.66 → **streaming keeps ahead of playback** ✅
- Time-to-first-audio, full first sentence: **3.5 s** ❌ (target < 2 s)
- First-clause trick (synth first 4–9 words separately): **1.5–2.3 s** ⚠️ borderline
  (+ ~0.5 s for the LLM to produce the first sentence ⇒ ~2–2.8 s first spoken word)

### Conclusion
CPU Kokoro is the *fallback*, not the default. **Production: Python GPU sidecar**
(kokoro on CUDA, ~1 GB VRAM — already in the Profile A budget); GPU RTF is ~10–20×
faster, expected first-audio well under 1 s. Keep the first-clause split regardless —
it helps both backends.

## Image co-residency benchmark — 2026-07-12 (`comfy-bench.mjs`, ComfyUI 0.27, DreamShaper 8 + LCM-LoRA, 6 steps, 768×512)

Run with llama3.1:8b **loaded and serving** in Ollama, other desktop apps still open.

- Warm generation: **1.05 s per image** ✅ (target was <8 s async — crushed)
- Cold first image (SD model load): 4.7 s (once per session)
- VRAM: 7.9 GB (LLM+apps) → **10.1 GB with SD resident** → ~2 GB headroom ✅ no OOM
- LLM with SD loaded: 0.88 s turnaround, **63.5 tok/s** — no degradation ✅
- Quality: atmospheric painterly tavern, good enough for crossfading scene art; LCM at
  cfg 1.5 drops some prompt details (no stranger in frame) and can leave small text-like
  artifacts at edges → mitigate with better prompt templates, light negative tuning, and
  a slight center-crop; revisit checkpoint choice during Phase 2 polish.

### Phase 0 exit criteria — verdict
| Criterion | Target | Measured | |
|---|---|---|---|
| First narration token | < 1 s | 0.2–0.35 s | ✅ |
| First spoken word | < 2 s | ~2–2.8 s CPU / GPU sidecar expected <1 s | ⚠️→✅ plan |
| Scene image (async) | < 8 s | 1.05 s warm | ✅ |
| Everything fits, no OOM | 12 GB | 10.1 GB with all three loaded | ✅ |

**Phase 0: PASSED.** Proceed to Phase 1 (solo text adventure core).

- [x] Kokoro GPU sidecar (2026-07-13): **~190 ms per sentence warm** on CUDA (vs 3.5 s CPU),
  2.6 s first-call CUDA warmup. Runs in the ComfyUI venv (`tools/tts-sidecar/server.py`).
- [ ] Deferred: ACE-Step mood-track batch (offline tooling, no latency risk — Phase 2)

## Phase 1 e2e (2026-07-13, `spikes/e2e-smoke.mjs` + `roll-smoke.mjs`, clean GPU)

- Campaign opening: scene art **2.3 s** (before narration even began), first narration text
  2.5 s, first spoken audio 4.4 s, opening complete 5.7 s.
- Player action turn: first narration text **1.26 s** after send (move pass + TTFT).
- Roll path: DM requested Stealth DC 13 via constrained move; engine rolled d20=3+5=8,
  failure narrated honestly. 14 voice sentences delivered in order.
- Full stack resident: **7.8 GB / 12.3 GB** VRAM (Ollama 8B @4k ctx + SD1.5 staged + Kokoro).
- Save/resume verified: server restart + rejoin lands mid-campaign with full state.
- Lesson learned: a running game (League of Legends) starved the GPU and stalled the LLM
  stream mid-narration → added 30 s inactivity abort + reduced num_ctx to 4096. Hosting
  while gaming is not supported; everything degrades gracefully instead of hanging.
