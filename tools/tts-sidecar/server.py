"""Grimoire narrator sidecar: Kokoro-82M on CUDA behind a tiny HTTP API.

Runs inside the ComfyUI venv (reuses its torch cu126 install).
  POST /tts   {"text": "...", "voice": "am_michael", "speed": 1.0}  -> audio/wav bytes
  GET  /health                                        -> {"ok": true, "device": "cuda"}
"""
import io
import math
import os
import re
import time

import soundfile as sf
import torch
from aiohttp import web
from kokoro import KModel, KPipeline

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SAMPLE_RATE = 24000

print(f"[tts] loading Kokoro on {DEVICE}...")
t0 = time.time()
# One model serves both language frontends. Kokoro voice prefixes define the matching language:
# `a*` is American English and `b*` is British English. This keeps bm_fable on its intended
# frontend without loading a second copy of the model into VRAM.
model = KModel().to(DEVICE).eval()
pipelines = {
    "a": KPipeline(lang_code="a", model=False),
    "b": KPipeline(lang_code="b", model=False),
}
VOICE_PATTERN = re.compile(r"^(?P<language>[ab])[fm]_[a-z0-9_]+$")
print(f"[tts] ready in {time.time() - t0:.1f}s")


async def tts(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except (ValueError, TypeError):
        return web.json_response({"error": "invalid JSON body"}, status=400)
    raw_text = body.get("text")
    text = raw_text.strip() if isinstance(raw_text, str) else ""
    voice = body.get("voice") or "am_michael"
    if not text:
        return web.json_response({"error": "empty text"}, status=400)
    if not isinstance(voice, str) or not (match := VOICE_PATTERN.fullmatch(voice)):
        return web.json_response({"error": "unsupported voice id"}, status=400)
    raw_speed = body.get("speed", 1.0)
    if isinstance(raw_speed, bool):
        return web.json_response({"error": "speed must be a number"}, status=400)
    try:
        speed = float(raw_speed)
    except (TypeError, ValueError):
        return web.json_response({"error": "speed must be a number"}, status=400)
    if not math.isfinite(speed) or not 0.5 <= speed <= 2.0:
        return web.json_response({"error": "speed must be between 0.5 and 2.0"}, status=400)

    t = time.time()
    pipeline = pipelines[match.group("language")]
    chunks = [audio for _, _, audio in pipeline(text, voice=voice, speed=speed, model=model)]
    if not chunks:
        return web.json_response({"error": "no audio produced"}, status=500)
    audio = torch.cat([c if isinstance(c, torch.Tensor) else torch.tensor(c) for c in chunks])

    buf = io.BytesIO()
    sf.write(buf, audio.cpu().numpy(), SAMPLE_RATE, format="WAV")
    ms = (time.time() - t) * 1000
    secs = len(audio) / SAMPLE_RATE
    print(f"[tts] {voice} @{speed:.2f} {len(text):4d} chars -> {secs:5.1f}s audio in {ms:6.0f}ms (RTF {ms / 1000 / secs:.3f})")
    return web.Response(body=buf.getvalue(), content_type="audio/wav")


async def health(_: web.Request) -> web.Response:
    return web.json_response({"ok": True, "device": DEVICE})


app = web.Application()
app.router.add_post("/tts", tts)
app.router.add_get("/health", health)

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=int(os.environ.get("GRIMOIRE_TTS_PORT", "8765")), print=None)
