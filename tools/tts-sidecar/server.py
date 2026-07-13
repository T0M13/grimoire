"""Grimoire narrator sidecar: Kokoro-82M on CUDA behind a tiny HTTP API.

Runs inside the ComfyUI venv (reuses its torch cu126 install).
  POST /tts   {"text": "...", "voice": "am_michael"}  -> audio/wav bytes
  GET  /health                                        -> {"ok": true, "device": "cuda"}
"""
import io
import os
import time

import soundfile as sf
import torch
from aiohttp import web
from kokoro import KPipeline

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SAMPLE_RATE = 24000

print(f"[tts] loading Kokoro on {DEVICE}...")
t0 = time.time()
pipeline = KPipeline(lang_code="a", device=DEVICE)  # 'a' = American English
print(f"[tts] ready in {time.time() - t0:.1f}s")


async def tts(request: web.Request) -> web.Response:
    body = await request.json()
    text = (body.get("text") or "").strip()
    voice = body.get("voice") or "am_michael"
    if not text:
        return web.json_response({"error": "empty text"}, status=400)

    t = time.time()
    chunks = [audio for _, _, audio in pipeline(text, voice=voice)]
    if not chunks:
        return web.json_response({"error": "no audio produced"}, status=500)
    audio = torch.cat([c if isinstance(c, torch.Tensor) else torch.tensor(c) for c in chunks])

    buf = io.BytesIO()
    sf.write(buf, audio.cpu().numpy(), SAMPLE_RATE, format="WAV")
    ms = (time.time() - t) * 1000
    secs = len(audio) / SAMPLE_RATE
    print(f"[tts] {len(text):4d} chars -> {secs:5.1f}s audio in {ms:6.0f}ms (RTF {ms / 1000 / secs:.3f})")
    return web.Response(body=buf.getvalue(), content_type="audio/wav")


async def health(_: web.Request) -> web.Response:
    return web.json_response({"ok": True, "device": DEVICE})


app = web.Application()
app.router.add_post("/tts", tts)
app.router.add_get("/health", health)

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=int(os.environ.get("GRIMOIRE_TTS_PORT", "8765")), print=None)
