// Follow-up: can we hit <2s time-to-first-audio on CPU by synthesizing the first
// clause (split at first comma/8-10 words) before the rest of the sentence?
import { KokoroTTS } from "kokoro-js";

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
const voice = "am_michael";

const clauses = [
  "The hooded stranger's eyes snap to yours",       // 8 words — typical first clause
  "For a long moment, only the rain speaks",        // 9 words
  "Then he leans forward",                          // 4 words
];

for (const c of clauses) {
  // warm + measure twice, keep second (steady-state)
  let ms = 0;
  for (let i = 0; i < 2; i++) {
    const t = performance.now();
    const a = await tts.generate(c, { voice });
    ms = performance.now() - t;
    if (i === 1) console.log(`"${c}" (${c.split(" ").length}w): ${(ms / 1000).toFixed(2)}s synth -> ${(a.audio.length / a.sampling_rate).toFixed(1)}s audio`);
  }
}
